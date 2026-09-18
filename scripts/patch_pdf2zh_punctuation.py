#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
# Downstream patch helper for PDFMathTranslate/pdf2zh. See
# THIRD_PARTY_NOTICES.md for the upstream project, license, and distribution
# boundary. Copyright (c) 2026 huqilin for the patch changes in this file.
"""Install a hard punctuation-preservation gate in pdf2zh's converter."""

from __future__ import annotations

import argparse
from pathlib import Path


DEFAULT_PATH = Path(
    "/home/huqilin/.local/share/uv/tools/pdf2zh/lib/python3.11/"
    "site-packages/pdf2zh/converter.py"
)


HELPERS = r'''        _PUNCTUATION_MAP = {
            ",": ",", "，": ",", "、": ",",
            ".": ".", "。": ".",
            ";": ";", "；": ";",
            ":": ":", "：": ":",
            "?": "?", "？": "?",
            "!": "!", "！": "!",
            "(": "(", "（": "(", ")": ")", "）": ")",
            "[": "[", "［": "[", "【": "[",
            "]": "]", "］": "]", "】": "]",
            "{": "{", "｛": "{", "}": "}", "｝": "}",
            '"': '"', "“": '"', "”": '"', "「": '"', "」": '"',
            "'": "'", "‘": "'", "’": "'",
            "%": "%", "％": "%", "/": "/", "／": "/",
            "\\": "\\", "+": "+", "＋": "+", "=": "=", "＝": "=",
            "*": "*", "＊": "*", "<": "<", ">": ">",
            "&": "&", "＆": "&", "·": "·", "•": "•",
            "…": "…",
        }
        _DASHES = set("-‐‑‒–—―")

        def _protected_tokens(text: str):
            return re.findall(r"\{v\d+\}|</?b\d+>", text)

        _STABLE_TOKEN_RE = re.compile(
            r"https?://[^\s)\]}>]+|"
            r"\b10\.\d{4,9}/[^\s)\]}>]+|"
            r"\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?%?\b"
        )

        def _stable_data_tokens(text: str):
            text = re.sub(r"\{v\d+\}|</?b\d+>", "", text)
            return [unicodedata.normalize("NFKC", token) for token in _STABLE_TOKEN_RE.findall(text)]

        _STRUCTURAL_PUNCTUATION = set("()[]{}")
        _FULLWIDTH_PUNCTUATION = {
            ",": "，", ".": "。", ";": "；", ":": "：",
            "?": "？", "!": "！", "…": "…",
        }

        def _protected_ranges(text: str):
            patterns = [
                re.compile(r"\{v\d+\}|</?b\d+>"),
                _STABLE_TOKEN_RE,
            ]
            ranges = []
            for pattern in patterns:
                ranges.extend((match.start(), match.end()) for match in pattern.finditer(text))
            return ranges

        def _editable_punctuation(text: str):
            ranges = _protected_ranges(text)
            items = []
            for index, char in enumerate(text):
                if any(start <= index < end for start, end in ranges):
                    continue
                if char in _DASHES:
                    continue
                token = _PUNCTUATION_MAP.get(char)
                if token:
                    items.append((index, token, char))
            return items

        def _render_punctuation(token: str, fullwidth: bool):
            return _FULLWIDTH_PUNCTUATION.get(token, token) if fullwidth else token

        def _repair_stable_tokens(source_text: str, translated_text: str):
            """Restore omitted numeric/URL data only when order is still monotonic."""
            if not translated_text:
                return translated_text
            source_matches = list(_STABLE_TOKEN_RE.finditer(source_text))
            translated_matches = list(_STABLE_TOKEN_RE.finditer(translated_text))
            source_tokens = [unicodedata.normalize("NFKC", match.group(0)) for match in source_matches]
            translated_tokens = [unicodedata.normalize("NFKC", match.group(0)) for match in translated_matches]
            if source_tokens == translated_tokens:
                return translated_text
            matched = {}
            target_index = 0
            missing = []
            for source_index, token in enumerate(source_tokens):
                if target_index < len(translated_tokens) and translated_tokens[target_index] == token:
                    matched[source_index] = target_index
                    target_index += 1
                else:
                    missing.append(source_index)
            if target_index != len(translated_tokens):
                return translated_text
            insertions = {}
            for source_index in missing:
                source_match = source_matches[source_index]
                token = source_match.group(0)
                previous_char = source_text[source_match.start() - 1] if source_match.start() else ""
                next_char = source_text[source_match.end()] if source_match.end() < len(source_text) else ""
                prefix = "" if previous_char in "([{/=" else (previous_char if previous_char in "-/" else " ")
                suffix = "" if next_char in ")]},.;:!?%/" else " "
                next_source = next((index for index in matched if index > source_index), None)
                previous_source = next((index for index in reversed(sorted(matched)) if index < source_index), None)
                if next_source is not None:
                    position = translated_matches[matched[next_source]].start()
                elif previous_source is not None:
                    position = translated_matches[matched[previous_source]].end()
                else:
                    position = len(translated_text)
                    prefix = " "
                if position < len(translated_text) and translated_text[position].isalnum():
                    suffix = " "
                if position > 0 and translated_text[position - 1].isalnum() and not prefix:
                    prefix = " "
                insertions.setdefault(position, []).append(prefix + token + suffix)
            repaired = []
            for index, char in enumerate(translated_text):
                if index in insertions:
                    repaired.extend(insertions[index])
                repaired.append(char)
            if len(translated_text) in insertions:
                repaired.extend(insertions[len(translated_text)])
            return "".join(repaired)

        def _repair_punctuation_shape(source_text: str, translated_text: str):
            """Repair only punctuation slots; never rewrite words or data tokens."""
            if not translated_text:
                return translated_text
            source_items = _editable_punctuation(source_text)
            translated_items = _editable_punctuation(translated_text)
            source_structural = [token for _, token, _ in source_items if token in _STRUCTURAL_PUNCTUATION]
            translated_structural = [token for _, token, _ in translated_items if token in _STRUCTURAL_PUNCTUATION]
            if source_structural != translated_structural:
                return translated_text
            source_linear = [token for _, token, _ in source_items if token not in _STRUCTURAL_PUNCTUATION]
            translated_linear = [item for item in translated_items if item[1] not in _STRUCTURAL_PUNCTUATION]
            if not source_linear and not translated_linear:
                return translated_text
            fullwidth = sum(char in "，。；：！？" for _, _, char in translated_linear) >= sum(
                char in ",.;:!?" for _, _, char in translated_linear
            )
            replacements = {}
            deletions = set()
            for item, desired in zip(translated_linear, source_linear):
                replacements[item[0]] = _render_punctuation(desired, fullwidth)
            if len(translated_linear) > len(source_linear):
                deletions.update(item[0] for item in translated_linear[len(source_linear):])
            suffix = ""
            if len(source_linear) > len(translated_linear):
                suffix = "".join(_render_punctuation(token, fullwidth) for token in source_linear[len(translated_linear):])
            repaired = "".join(
                replacements.get(index, char)
                for index, char in enumerate(translated_text)
                if index not in deletions
            )
            return repaired + suffix

        def _punctuation_tokens(text: str):
            # Formula and rich-text placeholders are structural data, not
            # prose punctuation. Hyphens are ignored because PDF extraction
            # inserts them at line wraps; technical terms remain in the text.
            text = re.sub(r"\{v\d+\}|</?b\d+>", "", text)
            text = re.sub(r"\.{3,}", "…", text)
            tokens = []
            for char in text:
                if char in _DASHES:
                    continue
                token = _PUNCTUATION_MAP.get(char)
                if token:
                    tokens.append(token)
            return tokens

        def _token_counts(tokens):
            counts = {}
            for token in tokens:
                counts[token] = counts.get(token, 0) + 1
            return counts

        def _balanced_delimiters(tokens):
            opening = {"(", "[", "{"}
            closing = {")": "(", "]": "[", "}": "{",
            }
            stack = []
            for token in tokens:
                if token in opening:
                    stack.append(token)
                elif token in closing:
                    if not stack or stack.pop() != closing[token]:
                        return False
            return not stack

        def _validate_translation_punctuation(source_text: str, translated_text: str):
            if not translated_text or not translated_text.strip():
                return False, "译文为空"
            source_protected = _protected_tokens(source_text)
            translated_protected = _protected_tokens(translated_text)
            if source_protected != translated_protected:
                return False, "公式或格式占位符被改写"
            source_stable = _stable_data_tokens(source_text)
            translated_stable = _stable_data_tokens(translated_text)
            if source_stable != translated_stable:
                return False, (
                    f"数字、单位、表格数据或引用标记不一致: "
                    f"source={source_stable} translated={translated_stable}"
                )
            source_tokens = _punctuation_tokens(source_text)
            translated_tokens = _punctuation_tokens(translated_text)
            if _token_counts(source_tokens) != _token_counts(translated_tokens):
                return False, (
                    f"source={_token_counts(source_tokens)} "
                    f"translated={_token_counts(translated_tokens)}"
                )
            if not _balanced_delimiters(translated_tokens):
                return False, "译文括号未闭合或嵌套顺序错误"
            return True, ""

'''


OLD_WORKER = '''                new = self.translator.translate(s)
                return new'''

NEW_WORKER = '''                new = self.translator.translate(s)
                for attempt in range(2):
                    valid, reason = _validate_translation_punctuation(s, new)
                    if valid:
                        return new
                    log.warning("punctuation validation failed (attempt %s): %s", attempt + 1, reason)
                    if attempt == 0:
                        repair = getattr(self.translator, "repair_punctuation", None)
                        if callable(repair):
                            new = repair(s, new)
                            new = _repair_stable_tokens(s, new)
                            new = _repair_punctuation_shape(s, new)
                        else:
                            try:
                                new = self.translator.translate(s, ignore_cache=True)
                            except TypeError as retry_error:
                                # Some custom translators do not expose the
                                # ignore_cache keyword; do_translate bypasses
                                # their cache without weakening the gate.
                                if "ignore_cache" not in str(retry_error):
                                    raise
                                new = self.translator.do_translate(s)
                        continue
                    raise ValueError(f"标点一致性校验失败: {reason}")
                raise ValueError("标点一致性校验失败")'''


def patch(path: Path) -> bool:
    source = path.read_text(encoding="utf-8")
    original = source

    source = source.replace(
        "from tenacity import retry, wait_fixed, stop_after_attempt, stop_after_attempt",
        "from tenacity import retry, wait_fixed, stop_after_attempt",
        1,
    )
    if "from tenacity import retry, wait_fixed, stop_after_attempt" not in source:
        source = source.replace(
            "from tenacity import retry, wait_fixed",
            "from tenacity import retry, wait_fixed, stop_after_attempt",
            1,
        )
    source = source.replace(
        "@retry(wait=wait_fixed(1))",
        "@retry(wait=wait_fixed(1), stop=stop_after_attempt(3))",
        1,
    )

    marker = "        @retry(wait=wait_fixed(1), stop=stop_after_attempt(3))\n"
    helper_start = source.find("        _PUNCTUATION_MAP = {")
    marker_index = source.find(marker)
    if helper_start >= 0 and marker_index > helper_start:
        current_helpers = source[helper_start:marker_index]
        if current_helpers != HELPERS:
            source = source[:helper_start] + HELPERS + source[marker_index:]
    elif marker in source:
        source = source.replace(marker, HELPERS + marker, 1)
    else:
        raise RuntimeError("converter.py punctuation marker missing")

    worker_start = source.find("                new = self.translator.translate(s)\n                for attempt in range(2):")
    worker_end_marker = '                raise ValueError("标点一致性校验失败")'
    worker_end = source.find(worker_end_marker, worker_start)
    if worker_start >= 0 and worker_end >= 0:
        worker_end += len(worker_end_marker)
        current_worker = source[worker_start:worker_end]
        if current_worker != NEW_WORKER:
            source = source[:worker_start] + NEW_WORKER + source[worker_end:]
    elif OLD_WORKER in source:
        source = source.replace(OLD_WORKER, NEW_WORKER, 1)
    else:
        raise RuntimeError("converter.py translation worker marker missing")

    if source == original:
        return False
    path.write_text(source, encoding="utf-8")
    return True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--converter", type=Path, default=DEFAULT_PATH)
    args = parser.parse_args()
    changed = patch(args.converter)
    print(f"{'patched' if changed else 'already patched'}: {args.converter}")


if __name__ == "__main__":
    main()
