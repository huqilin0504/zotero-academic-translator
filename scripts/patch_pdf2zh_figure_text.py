#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
# Downstream pdf2zh patch helper.
"""Keep text embedded in pdf2zh Form XObjects used by paper figures.

pdf2zh removes page-level text and lays it out again after translation. A
diagram is different: its labels belong to the figure and must remain visible.
"""

from __future__ import annotations

import argparse
from pathlib import Path


DEFAULT_PATH = Path(
    "/home/huqilin/.local/share/uv/tools/pdf2zh/lib/python3.11/"
    "site-packages/pdf2zh/pdfinterp.py"
)


def patch(path: Path) -> bool:
    source = path.read_text(encoding="utf-8")
    original = source

    if "def pdf_operand(value: Any) -> str:" not in source:
        marker = "log = logging.getLogger(__name__)\n\n\n"
        helper = (
            "log = logging.getLogger(__name__)\n\n\n"
            "def pdf_operand(value: Any) -> str:\n"
            "    \"\"\"Serialize a parsed PDF operand back to valid content syntax.\"\"\"\n"
            "    if isinstance(value, (bytes, bytearray, memoryview)):\n"
            "        return \"<\" + bytes(value).hex() + \">\"\n"
            "    if isinstance(value, (list, tuple)):\n"
            "        return \"[\" + \" \".join(pdf_operand(item) for item in value) + \"]\"\n"
            "    if isinstance(value, float):\n"
            "        return f\"{value:f}\"\n"
            "    return str(value).replace(\"'\", \"\")\n\n\n"
        )
        if marker not in source:
            raise RuntimeError("pdfinterp.py layout changed: logger marker missing")
        source = source.replace(marker, helper, 1)

    # Keep this patch idempotent while also upgrading older installations
    # whose helper only handled top-level byte strings.  Nested arrays are
    # required for TJ text arrays embedded in figure Form XObjects.
    old_helper = (
        "    if isinstance(value, (bytes, bytearray, memoryview)):\n"
        "        return \"<\" + bytes(value).hex() + \">\"\n"
        "    if isinstance(value, float):\n"
    )
    new_helper = (
        "    if isinstance(value, (bytes, bytearray, memoryview)):\n"
        "        return \"<\" + bytes(value).hex() + \">\"\n"
        "    if isinstance(value, (list, tuple)):\n"
        "        return \"[\" + \" \".join(pdf_operand(item) for item in value) + \"]\"\n"
        "    if isinstance(value, float):\n"
    )
    source = source.replace(old_helper, new_helper, 1)

    if "self.preserve_text = False" not in source:
        marker = "        self.obj_patch = obj_patch\n"
        replacement = (
            marker
            + "        # Page text is re-laid out; Form XObject labels are preserved.\n"
            + "        self.preserve_text = False\n"
        )
        if marker not in source:
            raise RuntimeError("pdfinterp.py layout changed: constructor marker missing")
        source = source.replace(marker, replacement, 1)

    if "duplicate.preserve_text = self.preserve_text" not in source:
        marker = "        duplicate = self.__class__(self.rsrcmgr, self.device, self.obj_patch)\n"
        if marker not in source:
            raise RuntimeError("pdfinterp.py layout changed: dup marker missing")
        source = source.replace(
            marker,
            marker + "        duplicate.preserve_text = self.preserve_text\n",
            1,
        )

    if "interpreter.preserve_text = True" not in source:
        marker = "            interpreter = self.dup()\n"
        if marker not in source:
            raise RuntimeError("pdfinterp.py layout changed: Form marker missing")
        source = source.replace(
            marker,
            marker
            + "            # Figure labels are part of the original Form XObject.\n"
            + "            interpreter.preserve_text = True\n",
            1,
        )

    source = source.replace(
        "if not (\n                                name[0] == \"T\"",
        "if self.preserve_text or not (\n                                name[0] == \"T\"",
        1,
    )
    source = source.replace(
        "if not (name[0] == \"T\" or name in [\"BI\", \"ID\", \"EMC\"]):",
        "if self.preserve_text or not (name[0] == \"T\" or name in [\"BI\", \"ID\", \"EMC\"]):",
        1,
    )

    # Do not serialize bytes with Python's b'...' repr; it is invalid PDF.
    old_args = (
        "p = \" \".join(\n"
        "                                    [\n"
        "                                        (\n"
        "                                            f\"{x:f}\"\n"
        "                                            if isinstance(x, float)\n"
        "                                            else str(x).replace(\"'\", \"\")\n"
        "                                        )\n"
        "                                        for x in args\n"
        "                                    ]\n"
        "                                )"
    )
    source = source.replace(old_args, "p = \" \".join([pdf_operand(x) for x in args])", 1)
    old_targs = (
        "p = \" \".join(\n"
        "                                [\n"
        "                                    (\n"
        "                                        f\"{x:f}\"\n"
        "                                        if isinstance(x, float)\n"
        "                                        else str(x).replace(\"'\", \"\")\n"
        "                                    )\n"
        "                                    for x in targs\n"
        "                                ]\n"
        "                            )"
    )
    source = source.replace(old_targs, "p = \" \".join([pdf_operand(x) for x in targs])", 1)

    if source == original:
        return False
    path.write_text(source, encoding="utf-8")
    return True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdfinterp", type=Path, default=DEFAULT_PATH)
    args = parser.parse_args()
    changed = patch(args.pdfinterp)
    print(f"{'patched' if changed else 'already patched'}: {args.pdfinterp}")


if __name__ == "__main__":
    main()
