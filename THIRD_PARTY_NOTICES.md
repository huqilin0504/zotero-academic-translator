# Third-party notices

This file records third-party software used by or expected by Zotero Academic
Translator. The licenses below are not replaced by the plugin's MIT license.

## PDFMathTranslate / pdf2zh

- Project: <https://github.com/PDFMathTranslate/PDFMathTranslate>
- License: GNU Affero General Public License, version 3 (AGPL-3.0)
- Upstream license text: <https://www.gnu.org/licenses/agpl-3.0.html>

`pdf2zh` is an external executable. It is not included in the XPI. The plugin
starts the executable configured by the user and communicates with it through
command-line arguments, environment variables, and process streams. Users must
install and use `pdf2zh` under its upstream license.

The files `scripts/patch_pdf2zh_*.py` are optional downstream patch helpers for
a locally installed `pdf2zh`. They are marked AGPL-3.0-only because they are
intended to adapt an AGPL-covered program. They do not contain a complete copy
of the upstream package. If a modified `pdf2zh` package or binary is
redistributed, the distributor must provide the corresponding source, retain
the upstream notices, mark modifications, and satisfy the full AGPL-3.0 terms.

## KaTeX

- Project: <https://github.com/KaTeX/KaTeX>
- License: MIT
- Copyright: © 2013–2020 Khan Academy and other contributors
- License text: <https://github.com/KaTeX/KaTeX/blob/main/LICENSE>

The plugin bundles KaTeX-compatible CSS and font files in the XPI for offline
formula rendering. The KaTeX copyright and MIT permission notice is preserved
here for that bundled material.

## Other npm dependencies

Build-time dependencies are installed from npm according to `package.json` and
`package-lock.json`. Their individual license metadata remains authoritative;
the generated XPI does not bundle their development packages.
