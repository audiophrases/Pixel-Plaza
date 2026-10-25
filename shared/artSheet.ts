// Sample each cell independently after decoding in the browser or installer.
export function sheetTransparencyProblem(pixels: Uint8Array | Uint8ClampedArray, width: number, height: number): string | null {
    if (pixels.length !== width * height * 4 || width !== height || width < 2) return 'The art sheet could not be read as a square RGBA image.';
    const half = Math.floor(width / 2), step = Math.max(1, Math.floor(width / 64));
    for (let cell = 0; cell < 4; cell++) {
        let clear = 0, solid = 0, samples = 0;
        for (let y = 0; y < half; y += step) for (let x = 0; x < half; x += step) {
            const a = pixels[((y + Math.floor(cell / 2) * half) * width + x + cell % 2 * half) * 4 + 3];
            samples++; if (a < 32) clear++; if (a > 200) solid++;
        }
        if (clear < samples * .01 || solid < samples * .03) return 'Each slot needs one visible object and a transparent background. Ask the AI for true transparency, not a drawn checkerboard.';
    }
    return null;
}
