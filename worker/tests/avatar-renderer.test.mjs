import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { balanced, renderAvatarSvg, renderFigureParts } from '../../src/utils/AvatarRenderer.ts';
import { sanitizeAvatar } from '../rules.ts';

test('every PinPlay character survives validation and uses its selected head in portrait and map', () => {
    const previous = globalThis.window;
    const context = { window: {} };
    vm.runInNewContext(fs.readFileSync(new URL('../../public/cup/avatar-parts.js', import.meta.url), 'utf8'), context);
    globalThis.window = context.window;
    try {
        const catalog = window.CUP_AVATAR;
        for (const preset of catalog.presets) {
            const avatar = sanitizeAvatar(preset.avatar);
            assert.ok(avatar, preset.name);
            const head = catalog.parts.head[avatar.head];
            const paintedHead = balanced(head.head).replace(/#00FFFF/gi, catalog.skins[avatar.skin]).replace(/#FF00FF/gi, catalog.hairColors[avatar.hairColor]);
            assert.ok(renderAvatarSvg(avatar).includes(paintedHead), preset.name);
            assert.ok(renderFigureParts(avatar).headDown.svg.includes(paintedHead), preset.name);
        }
        assert.equal(renderAvatarSvg({}), renderAvatarSvg({ head: 0 }));

        // The map loads every piece as an image, and a malformed one leaves a ghost: a shadow and no body.
        const parser = new new JSDOM('').window.DOMParser();
        const counts = { skin: catalog.skins.length, hairColor: catalog.hairColors.length,
            ...Object.fromEntries(Object.entries(catalog.parts).map(([key, list]) => [key, list.length])) };
        for (const [key, count] of Object.entries(counts)) for (let index = 0; index < count; index++) {
            for (const [name, piece] of Object.entries(renderFigureParts({ [key]: index }))) {
                const broken = parser.parseFromString(piece.svg, 'image/svg+xml').getElementsByTagName('parsererror')[0];
                assert.equal(broken?.textContent, undefined, `${key} ${index}, ${name}`);
            }
        }
        // Levels add colours: trousers, shoes and a cape, each still a well-formed piece.
        const dressed = renderFigureParts({}, { pants: '#E53935', shoes: '#1E88E5', cape: '#8E24AA' });
        assert.ok(dressed.leg.svg.includes('#E53935') && dressed.leg.svg.includes('#1E88E5'));
        assert.ok(dressed.cape.svg.includes('#8E24AA'));
        assert.equal(parser.parseFromString(dressed.cape.svg, 'image/svg+xml').getElementsByTagName('parsererror')[0]?.textContent, undefined);
        assert.equal(renderFigureParts({}).cape, undefined, 'no cape unless chosen');
        assert.equal(balanced('<g><g></g></g></g>'), '<g><g></g></g>');
        assert.equal(balanced('<g><rect/>'), '<g><rect/></g>');
    } finally {
        if (previous === undefined) delete globalThis.window;
        else globalThis.window = previous;
    }
});
