import hashlib
import io
import json
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from installer.core import Session, binary_from_tar, ipk, tar_bytes, validate_tv


class InstallerTests(unittest.TestCase):
    def test_only_private_unicast_targets(self):
        for value in [
            "127.0.0.1",
            "1.1.1.1",
            "239.255.255.250",
            "0.0.0.0",
            "::1",
            None,
            "not-ip",
        ]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_tv(value)
        self.assertEqual(validate_tv("192.0.2.20"), "192.0.2.20")

    def test_ipk_ar_and_explicit_privilege(self):
        data = ipk("local.vidaa.vpn.test", "#!/bin/sh\nexit 0\n")
        self.assertTrue(data.startswith(b"!<arch>\n"))
        pos = 8
        members = {}
        while pos < len(data):
            h = data[pos : pos + 60]
            size = int(h[48:58])
            name = h[:16].decode().strip().rstrip("/")
            pos += 60
            members[name] = data[pos : pos + size]
            pos += size + (size % 2)
        with tarfile.open(
            fileobj=io.BytesIO(members["control.tar.gz"]), mode="r:gz"
        ) as t:
            body = t.extractfile("./control").read()
            self.assertIn(b"Userid: 0:0", body)
            self.assertNotIn(b"password", body)

    def test_archive_hash_and_symlink_rejection(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "fixture.tar.gz"
            blob = b"\x7fELFsynthetic"
            archive.write_bytes(tar_bytes({"folder/client": (blob, 0o755)}))
            self.assertEqual(
                binary_from_tar(archive, "client", hashlib.sha256(blob).hexdigest()),
                blob,
            )
            with self.assertRaises(ValueError):
                binary_from_tar(archive, "client", "0" * 64)
            with tarfile.open(archive, "w:gz") as t:
                m = tarfile.TarInfo("client")
                m.type = tarfile.SYMTYPE
                m.linkname = "/etc/passwd"
                t.addfile(m)
            with self.assertRaises(ValueError):
                binary_from_tar(archive, "client", "0" * 64)

    def session(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        with patch("installer.core.local_address", return_value="192.0.2.10"):
            return Session("192.0.2.20", cache=Path(directory.name))

    def test_failure_cancels_queued_mutations(self):
        s = self.session()
        s.add("place", asset="a")
        s.add("invoke", asset="launch.js")
        s.fail("TEST_FAILURE")
        job = s.next_job()
        self.assertEqual(job["op"], "finish")
        self.assertFalse(job["ok"])

    def test_duplicate_results_do_not_schedule_duplicate_preparation(self):
        s = self.session()
        s.add("invoke", phase="preflight")
        job = s.next_job()
        result = {"id": job["id"], "result": {"ok": True, "phoenix": True}}
        s.result(result)
        s.result(result)
        self.assertEqual(len(s.jobs), 2)

    def test_failed_preparation_cleanup_runs_before_finish(self):
        s = self.session()
        s.prepared = True
        s.add("place", asset="a")
        s.fail("TEST_FAILURE")
        self.assertEqual(s.state, "cleaning_failed")
        job = s.next_job()
        self.assertEqual(job["phase"], "cleanup_failure")
        s.result({"id": job["id"], "result": {"ok": True}})
        self.assertEqual(s.state, "failed")
        self.assertEqual(s.next_job()["op"], "finish")

    def test_generated_helpers_are_valid_javascript_without_hardware(self):
        import subprocess

        s = self.session()
        s.operation = "remove"
        s.prepare()
        for name, data in s.files.items():
            if name.endswith(".js"):
                result = subprocess.run(
                    ["node", "--check"], input=data, capture_output=True
                )
                self.assertEqual(result.returncode, 0, (name, result.stderr.decode()))

    def test_manifest_contains_immutable_ca_and_pinned_binary_hashes(self):
        manifest = json.loads((ROOT / "installer/runtimes.json").read_text())
        for key in ["sing-box", "mieru"]:
            self.assertEqual(len(manifest[key]["binary_sha256"]), 64)
            self.assertEqual(len(manifest[key]["archive_sha256"]), 64)
        self.assertRegex(manifest["ca"]["url"], r"/[0-9a-f]{40}/")


if __name__ == "__main__":
    unittest.main()
