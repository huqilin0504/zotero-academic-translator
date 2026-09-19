export const PDF_LINK_REPAIR_SCRIPT = String.raw`
import json
import os
import re
import sys
from urllib.parse import unquote

import fitz


def _rect_tuple(rect):
    return (float(rect.x0), float(rect.y0), float(rect.x1), float(rect.y1))


def _scale_rect(rect, source_rect, target_rect):
    sx = target_rect.width / source_rect.width if source_rect.width else 1.0
    sy = target_rect.height / source_rect.height if source_rect.height else 1.0
    return fitz.Rect(
        target_rect.x0 + (rect.x0 - source_rect.x0) * sx,
        target_rect.y0 + (rect.y0 - source_rect.y0) * sy,
        target_rect.x0 + (rect.x1 - source_rect.x0) * sx,
        target_rect.y0 + (rect.y1 - source_rect.y0) * sy,
    )


def _scale_point(point, source_rect, target_rect):
    if point is None:
        return fitz.Point(0, 0)
    sx = target_rect.width / source_rect.width if source_rect.width else 1.0
    sy = target_rect.height / source_rect.height if source_rect.height else 1.0
    return fitz.Point(
        target_rect.x0 + (float(point.x) - source_rect.x0) * sx,
        target_rect.y0 + (float(point.y) - source_rect.y0) * sy,
    )


def _destination_point(source_link, source_page):
    point = source_link.get("to")
    if point is not None:
        return point
    destination = source_link.get("dest")
    if not isinstance(destination, str):
        return None
    match = re.search(
        r"/(?:FitR|XYZ)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)",
        destination,
    )
    if not match:
        return None
    x = float(match.group(1))
    pdf_y = float(match.group(2))
    return fitz.Point(x, source_page.rect.height - pdf_y)


def _clip_rect(rect, page_rect):
    clipped = fitz.Rect(rect)
    clipped &= fitz.Rect(page_rect)
    if clipped.width <= 0 or clipped.height <= 0:
        return None
    return clipped


def _source_page_targets(kind, link, source_count):
    if kind not in (fitz.LINK_GOTO, fitz.LINK_NAMED):
        return None
    page = link.get("page")
    if isinstance(page, int) and 0 <= page < source_count:
        return page
    return None


def _build_link(source_link, source_page, target_page, source_count, page_map):
    kind = int(source_link.get("kind", fitz.LINK_NONE))
    rect = _clip_rect(
        _scale_rect(source_link.get("from", fitz.Rect()), source_page.rect, target_page.rect),
        target_page.rect,
    )
    if rect is None:
        return None

    mapped_source_page = _source_page_targets(kind, source_link, source_count)
    if mapped_source_page is not None:
        mapped_target_page = page_map.get(mapped_source_page)
        if mapped_target_page is None:
            return None
        result = {
            "kind": fitz.LINK_GOTO,
            "from": rect,
            "page": int(mapped_target_page),
        }
        destination_point = _destination_point(source_link, source_page)
        if destination_point is not None:
            result["to"] = _scale_point(destination_point, source_page.rect, target_page.rect)
        if source_link.get("zoom") is not None:
            result["zoom"] = float(source_link.get("zoom") or 0)
        return result

    if kind == fitz.LINK_URI:
        uri = source_link.get("uri")
        if not uri:
            return None
        return {"kind": fitz.LINK_URI, "from": rect, "uri": str(uri)}

    if kind == fitz.LINK_LAUNCH:
        file_name = source_link.get("file")
        if not file_name:
            return None
        return {"kind": fitz.LINK_LAUNCH, "from": rect, "file": unquote(str(file_name))}

    if kind == fitz.LINK_GOTOR:
        file_name = source_link.get("file")
        if not file_name:
            return None
        result = {
            "kind": fitz.LINK_GOTOR,
            "from": rect,
            "file": unquote(str(file_name)),
            "page": int(source_link.get("page", 0) or 0),
        }
        destination_point = _destination_point(source_link, source_page)
        if destination_point is not None:
            result["to"] = _scale_point(destination_point, source_page.rect, target_page.rect)
        if source_link.get("zoom") is not None:
            result["zoom"] = float(source_link.get("zoom") or 0)
        return result

    if kind == fitz.LINK_NAMED:
        name = source_link.get("name") or source_link.get("nameddest")
        if not name:
            return None
        return {"kind": fitz.LINK_NAMED, "from": rect, "name": str(name)}

    return None


def _page_map(source_count, target_count, mode, translated):
    result = {}
    for source_index in range(source_count):
        if mode == "dual":
            target_index = source_index * 2 + (1 if translated else 0)
        else:
            target_index = source_index
        if target_index < target_count:
            result[source_index] = target_index
    return result


def _replace_page_links(page, links):
    for old_link in list(page.get_links()):
        page.delete_link(old_link)
    inserted = 0
    skipped = 0
    for link in links:
        try:
            page.insert_link(link)
            inserted += 1
        except Exception:
            skipped += 1
    return inserted, skipped


def _verify(doc, expected_by_page):
    invalid = 0
    observed = 0
    for page_index, expected in expected_by_page.items():
        page = doc[page_index]
        links = page.get_links()
        observed += len(links)
        if len(links) < expected:
            invalid += expected - len(links)
        for link in links:
            kind = int(link.get("kind", fitz.LINK_NONE))
            if kind in (fitz.LINK_GOTO, fitz.LINK_NAMED):
                destination = link.get("page")
                if isinstance(destination, int) and (destination < 0 or destination >= doc.page_count):
                    invalid += 1
            elif kind == fitz.LINK_URI and not link.get("uri"):
                invalid += 1
            elif kind in (fitz.LINK_LAUNCH, fitz.LINK_GOTOR) and not link.get("file"):
                invalid += 1
    return observed, invalid


def repair(source_path, target_path, mode):
    source = fitz.open(source_path)
    target = fitz.open(target_path)
    source_count = source.page_count
    target_count = target.page_count
    if source_count == 0 or target_count == 0:
        raise RuntimeError("source or target PDF has no pages")
    required_pages = source_count * (2 if mode == "dual" else 1)
    if target_count < required_pages:
        raise RuntimeError(
            "target PDF has %d pages, but %d are required for %s link mapping"
            % (target_count, required_pages, mode)
        )

    source_links = []
    for source_index in range(source_count):
        page = source[source_index]
        source_links.append(list(page.get_links()))

    translated_targets = _page_map(source_count, target_count, mode, True)
    original_targets = _page_map(source_count, target_count, mode, False)
    page_expectations = {}
    inserted_total = 0
    skipped_total = 0
    unmapped_total = 0

    page_sets = [(original_targets, "original")]
    if mode == "dual":
        page_sets.append((translated_targets, "translated"))
    for page_map, _label in page_sets:
        for source_index, target_index in page_map.items():
            source_page = source[source_index]
            target_page = target[target_index]
            source_page_links = source_links[source_index]
            rebuilt = []
            for source_link in source_page_links:
                converted = _build_link(
                    source_link,
                    source_page,
                    target_page,
                    source_count,
                    page_map,
                )
                if converted is not None:
                    rebuilt.append(converted)
            unmapped_total += len(source_page_links) - len(rebuilt)
            inserted, skipped = _replace_page_links(target_page, rebuilt)
            inserted_total += inserted
            skipped_total += skipped
            page_expectations[target_index] = len(rebuilt)

    temp_path = target_path + ".link-repair.tmp"
    try:
        target.save(temp_path, garbage=4, deflate=True)
        target.close()
        os.replace(temp_path, target_path)
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)
        source.close()

    verified = fitz.open(target_path)
    observed, invalid = _verify(verified, page_expectations)
    verified.close()
    if unmapped_total:
        raise RuntimeError("link conversion skipped: %d source links" % unmapped_total)
    if invalid:
        raise RuntimeError("link verification failed: %d invalid links" % invalid)
    return {
        "source_pages": source_count,
        "target_pages": target_count,
        "source_links_per_copy": sum(len(x) for x in source_links),
        "copies": 2 if mode == "dual" else 1,
        "inserted": inserted_total,
        "skipped": skipped_total,
        "verified": observed,
        "mode": mode,
    }


def main():
    if len(sys.argv) != 4:
        raise SystemExit("usage: repair_links.py SOURCE TARGET mono|dual")
    result = repair(sys.argv[1], sys.argv[2], sys.argv[3])
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
`;

export function buildPdfLinkRepairArgs(
  sourcePdfPath: string,
  targetPdfPath: string,
  mode: 'mono' | 'dual'
): string[] {
  return ['-c', PDF_LINK_REPAIR_SCRIPT, sourcePdfPath, targetPdfPath, mode];
}

export function resolvePdfPythonCandidates(pdf2zhBin: string): string[] {
  const normalized = pdf2zhBin || '';
  const separator = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  const binDir = separator >= 0 ? normalized.substring(0, separator) : '';
  return [...new Set([
    binDir ? `${binDir}/python` : '',
    'python3',
  ].filter(Boolean))];
}
