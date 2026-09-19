#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
# Downstream pdf2zh patch helper.
"""Patch pdf2zh's text reflow for Chinese PDF output.

The upstream layout code only wrapped translated text when the source line
already contained a line break. That is unsafe for Chinese captions and it
also splits Latin words at the right margin. This patch makes wrapping
unconditional, uses a visible hyphen when a Latin word reaches the margin,
and reflows ordinary text blocks within each column while retaining the
source paragraph gap.
"""

from __future__ import annotations

import argparse
from pathlib import Path


DEFAULT_PATH = Path(
    "/home/huqilin/.local/share/uv/tools/pdf2zh/lib/python3.11/"
    "site-packages/pdf2zh/converter.py"
)


def patch(path: Path) -> bool:
    source = path.read_text(encoding="utf-8")
    original = source

    if "def measure_text(text: str, font_name: str, size: float)" not in source:
        marker = (
            "            else:\n"
            "                return \"\".join([\"%02x\" % ord(c) for c in cstk])\n"
            "\n"
            "        # 根据目标语言获取默认行距\n"
        )
        replacement = (
            "            else:\n"
            "                return \"\".join([\"%02x\" % ord(c) for c in cstk])\n"
            "\n"
            "        def is_latin_word_char(char: str) -> bool:\n"
            "            return bool(char) and char.isascii() and (\n"
            "                char.isalnum() or char in \"_/'-\"\n"
            "            )\n"
            "\n"
            "        def is_closing_punctuation(char: str) -> bool:\n"
            "            return bool(char) and char in \"，。；：！？、…)]}〉》」』】）〕〗”’％\"\n"
            "\n"
            "        def measure_text(text: str, font_name: str, size: float) -> float:\n"
            "            if font_name == self.noto_name:\n"
            "                return sum(self.noto.char_lengths(char, size)[0] for char in text)\n"
            "            return sum(\n"
            "                self.fontmap[font_name].char_width(ord(char)) * size\n"
            "                for char in text\n"
            "            )\n"
            "\n"
            "        def choose_hyphen_break(word: str, font_name: str, size: float, available: float) -> int:\n"
            "            \\\"\\\"\\\"Return the longest readable prefix that fits before a hyphen.\\\"\\\"\\\"\n"
            "            if not re.fullmatch(r\"[A-Za-z][A-Za-z0-9]*\", word) or len(word) < 7:\n"
            "                return 0\n"
            "            best = 0\n"
            "            for split in range(3, len(word) - 2):\n"
            "                if measure_text(word[:split] + \"-\", font_name, size) <= available:\n"
            "                    best = split\n"
            "            return best\n"
            "\n"
            "        # 根据目标语言获取默认行距\n"
        )
        if marker not in source:
            raise RuntimeError("converter.py layout changed: raw_string marker missing")
        source = source.replace(marker, replacement, 1)

    source = source.replace("参考文献)\x08", "参考文献)\\b", 1)

    old_layout = """                overflow = x + adv > x1 + 0.1 * size
                if (                                # 输出文字缓冲区
                    fcur_ != fcur                   # 1. 字体更新
                    or ch_bold != fcur_bold         # 2. 粗体属性变更
                    or vy_regex                     # 3. 插入公式
                    or overflow                               # 4. 到达右边界
                ):
                    # 翻译后的中文不能沿用“原文是否换行”的开关，否则单行
                    # 图注或短段落会直接越过栏宽。先换行，再决定是否拆词。
                    if overflow and cstk and not vy_regex and is_latin_word_char(ch):
                        word_match = re.search(r"[A-Za-z0-9][A-Za-z0-9_/'-]*$", cstk)
                    else:
                        word_match = None
                    if word_match and word_match.start() > 0:
                        prefix = cstk[:word_match.start()]
                        carry = cstk[word_match.start():]
                        ops_vals.append({
                            "type": OpType.TEXT,
                            "font": fcur,
                            "size": size,
                            "x": tx,
                            "dy": 0,
                            "rtxt": raw_string(fcur, prefix),
                            "lidx": lidx,
                            "bold": fcur_bold
                        })
                        cstk = carry
                        tx = x0
                        x = x0 + measure_text(carry, fcur, size)
                        lidx += 1
                    elif cstk:
                        ops_vals.append({
                            "type": OpType.TEXT,
                            "font": fcur,
                            "size": size,
                            "x": tx,
                            "dy": 0,
                            "rtxt": raw_string(fcur, cstk),
                            "lidx": lidx,
                            "bold": fcur_bold
                        })
                        cstk = ""
                    if overflow and not (word_match and word_match.start() > 0):
                        x = x0
                        tx = x0
                        lidx += 1
"""
    new_layout = """                force_word_break = False
                if not vy_regex and is_latin_word_char(ch):
                    word_ahead = re.match(
                        r"[A-Za-z0-9][A-Za-z0-9_/'-]*", new[ptr - 1:]
                    )
                    if word_ahead and x > x0 + 0.1 * size:
                        word_width = measure_text(word_ahead.group(0), fcur_, size)
                        force_word_break = (
                            word_width <= (x1 - x0) + 0.1 * size
                            and x + word_width > x1 + 0.1 * size
                        )
                closing_punctuation = not vy_regex and is_closing_punctuation(ch)
                punctuation_overrun = 1.05 * size if closing_punctuation else 0
                overflow = x + adv > x1 + 0.1 * size + punctuation_overrun or force_word_break
                hyphenated = False
                if (                                # 输出文字缓冲区
                    fcur_ != fcur                   # 1. 字体更新
                    or ch_bold != fcur_bold         # 2. 粗体属性变更
                    or vy_regex                     # 3. 插入公式
                    or overflow                     # 4. 到达右边界
                ):
                    # 翻译后的中文不能沿用“原文是否换行”的开关，否则单行
                    # 图注或短段落会直接越过栏宽。英文单词在栏尾优先使用
                    # 连字符断词，避免出现大块空白或把单词拆成无提示的乱码。
                    word_match = None
                    if overflow and not vy_regex and is_latin_word_char(ch):
                        word_match = re.search(r"[A-Za-z0-9][A-Za-z0-9_/'-]*$", cstk)
                        word_start = ptr - 1
                        while word_start > 0 and is_latin_word_char(new[word_start - 1]):
                            word_start -= 1
                        word_end = ptr
                        while word_end < len(new) and is_latin_word_char(new[word_end]):
                            word_end += 1
                        word = new[word_start:word_end]
                        buffer_start = ptr - len(cstk)
                        if word_start >= buffer_start:
                            prefix_len = word_start - buffer_start
                            prefix = cstk[:prefix_len]
                            prefix_font = fcur or fcur_
                            available = x1 - tx - measure_text(prefix, prefix_font, size)
                            split = choose_hyphen_break(word, fcur_ or fcur_, size, available)
                            if split:
                                if prefix:
                                    ops_vals.append({
                                        "type": OpType.TEXT,
                                        "font": prefix_font,
                                        "size": size,
                                        "x": tx,
                                        "dy": 0,
                                        "rtxt": raw_string(prefix_font, prefix),
                                        "lidx": lidx,
                                        "bold": fcur_bold
                                    })
                                ops_vals.append({
                                    "type": OpType.TEXT,
                                    "font": fcur_,
                                    "size": size,
                                    "x": tx + measure_text(prefix, prefix_font, size),
                                    "dy": 0,
                                    "rtxt": raw_string(fcur_, word[:split] + "-"),
                                    "lidx": lidx,
                                    "bold": ch_bold
                                })
                                ptr = word_start + split
                                cstk = ""
                                tx = x0
                                x = x0
                                lidx += 1
                                hyphenated = True
                    if hyphenated:
                        fcur = fcur_
                        fcur_bold = ch_bold
                        continue
                    if word_match and word_match.start() > 0:
                        prefix = cstk[:word_match.start()]
                        carry = cstk[word_match.start():]
                        ops_vals.append({
                            "type": OpType.TEXT,
                            "font": fcur,
                            "size": size,
                            "x": tx,
                            "dy": 0,
                            "rtxt": raw_string(fcur, prefix),
                            "lidx": lidx,
                            "bold": fcur_bold
                        })
                        cstk = carry
                        tx = x0
                        x = x0 + measure_text(carry, fcur, size)
                        lidx += 1
                    elif cstk:
                        ops_vals.append({
                            "type": OpType.TEXT,
                            "font": fcur,
                            "size": size,
                            "x": tx,
                            "dy": 0,
                            "rtxt": raw_string(fcur, cstk),
                            "lidx": lidx,
                            "bold": fcur_bold
                        })
                        cstk = ""
                    if overflow and not (word_match and word_match.start() > 0):
                        x = x0
                        tx = x0
                        lidx += 1
"""
    if old_layout in source:
        source = source.replace(old_layout, new_layout, 1)
    elif "force_word_break = False" not in source:
        raise RuntimeError("converter.py layout changed: wrapping block missing")

    old_emit = """        for id, new in enumerate(news):
            x: float = pstk[id].x                       # 段落初始横坐标
"""
    new_emit = """        rendered_paragraphs = []

        for id, new in enumerate(news):
            x: float = pstk[id].x                       # 段落初始横坐标
"""
    if old_emit in source and "rendered_paragraphs = []" not in source:
        source = source.replace(old_emit, new_emit, 1)
    elif "rendered_paragraphs = []" not in source:
        raise RuntimeError("converter.py layout changed: paragraph loop marker missing")

    old_emit_tail = """            line_height = default_line_height

            while (lidx + 1) * size * line_height > height and line_height >= 1:
                line_height -= 0.05

            for vals in ops_vals:
                if vals["type"] == OpType.TEXT:
                    ops_list.append(gen_op_txt(vals["font"], vals["size"], vals["x"], vals["dy"] + y - vals["lidx"] * size * line_height, vals["rtxt"], is_bold=vals.get("bold", False)))
                elif vals["type"] == OpType.LINE:
                    ops_list.append(gen_op_line(vals["x"], vals["dy"] + y - vals["lidx"] * size * line_height, vals["xlen"], vals["ylen"], vals["linewidth"]))

        for l in lstk:  # 排版全局线条
"""
    new_emit_tail = """            line_height = default_line_height

            while (lidx + 1) * size * line_height > height and line_height >= 1:
                line_height -= 0.05

            rendered_paragraphs.append({
                "id": id,
                "paragraph": pstk[id],
                "ops": ops_vals,
                "y": y,
                "line_step": size * line_height,
                "line_count": max((vals["lidx"] for vals in ops_vals), default=0) + 1,
                "render_y": y,
            })

        def reflow_column_key(paragraph):
            # Keep figure captions, full-width headings, page furniture and
            # other anchors fixed. Only ordinary text blocks in the same
            # visual column participate in vertical paragraph reflow.
            width = max(0.0, paragraph.x1 - paragraph.x0)
            if width > ltpage.width * 0.72:
                return None
            if paragraph.y > ltpage.height * 0.94 or paragraph.y < ltpage.height * 0.07:
                return None
            center = (paragraph.x0 + paragraph.x1) / 2
            return "left" if center < ltpage.width / 2 else "right"

        column_groups = {}
        for item in rendered_paragraphs:
            key = reflow_column_key(item["paragraph"])
            if key is not None:
                column_groups.setdefault(key, []).append(item)

        # pdf2zh normally writes every translated block back to its original
        # y coordinate. That preserves anchors but leaves a large hole when a
        # Chinese translation uses fewer lines than the English source. Pack
        # blocks in reading order while retaining the exact source gap between
        # the previous block's bottom and the next block's first line.
        for group in column_groups.values():
            group.sort(key=lambda item: (-item["paragraph"].y, item["paragraph"].x0))
            previous = None
            for item in group:
                if previous is not None:
                    source_gap = max(
                        0.0,
                        previous["paragraph"].y0 - item["paragraph"].y,
                    )
                    item["render_y"] = previous["render_bottom"] - source_gap
                item["render_bottom"] = item["render_y"] - (
                    item["line_count"] - 1
                ) * item["line_step"]
                previous = item

        for item in rendered_paragraphs:
            for vals in item["ops"]:
                if vals["type"] == OpType.TEXT:
                    ops_list.append(gen_op_txt(
                        vals["font"], vals["size"], vals["x"],
                        vals["dy"] + item["render_y"]
                        - vals["lidx"] * item["line_step"],
                        vals["rtxt"], is_bold=vals.get("bold", False)
                    ))
                elif vals["type"] == OpType.LINE:
                    ops_list.append(gen_op_line(
                        vals["x"], vals["dy"] + item["render_y"]
                        - vals["lidx"] * item["line_step"],
                        vals["xlen"], vals["ylen"], vals["linewidth"]
                    ))

        for l in lstk:  # 排版全局线条
"""
    if old_emit_tail in source:
        source = source.replace(old_emit_tail, new_emit_tail, 1)
    elif "rendered_paragraphs.append({" not in source:
        raise RuntimeError("converter.py layout changed: paragraph emission block missing")

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
