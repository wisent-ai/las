#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

if [ "$#" -eq 0 ]; then
    set -- Echo Most Probierz Brama Warsztat Finance Byk
fi

CODESIGN_IDENTITY=${WISENT_CODESIGN_IDENTITY:-}
if [ -z "$CODESIGN_IDENTITY" ]; then
    CODESIGN_IDENTITY=$(security find-identity -v -p codesigning 2>/dev/null \
        | awk -F '"' '/Apple Development:/ { print $2; exit }')
fi
if [ -z "$CODESIGN_IDENTITY" ] || [ "$CODESIGN_IDENTITY" = "-" ]; then
    printf '%s\n' "Stable Apple Development signing identity is required; refusing ad-hoc signing." >&2
    exit 1
fi

for APP in "$@"; do
    case "$APP" in
        Echo|Most|Probierz|Brama|Warsztat|Finance|Byk) ;;
        *) printf 'Unknown app: %s\n' "$APP" >&2; exit 64 ;;
    esac

    swift build --package-path "$ROOT" --configuration release --product "$APP"
    BIN_DIR=$(swift build --package-path "$ROOT" --configuration release --show-bin-path)
    BUNDLE="$ROOT/.build/$APP.app"
    CONTENTS="$BUNDLE/Contents"
    MACOS="$CONTENTS/MacOS"

    rm -rf "$BUNDLE"
    mkdir -p "$MACOS"
    install -m 0644 "$ROOT/App/$APP/Info.plist" "$CONTENTS/Info.plist"
    install -m 0755 "$BIN_DIR/$APP" "$MACOS/$APP"
    codesign --force --deep --sign "$CODESIGN_IDENTITY" --timestamp=none "$BUNDLE"
    codesign --verify --strict --deep "$BUNDLE"
    printf 'Built %s\n' "$BUNDLE"
done
