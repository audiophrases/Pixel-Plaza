// Sample each cell independently after decoding in the browser or installer.
export function sheetTransparencyProblem(pixels: Uint8Array | Uint8ClampedArray, width: number, height: number, columns = 2, rows = 2): string | null {
    if (pixels.length !== width * height * 4 || width < columns || height < rows) return 'The art sheet could not be read as an RGBA image.';
    const cellW = Math.floor(width / columns), cellH = Math.floor(height / rows), step = Math.max(1, Math.floor(Math.min(cellW, cellH) / 32));
    for (let cell = 0; cell < columns * rows; cell++) {
        let clear = 0, solid = 0, samples = 0;
        for (let y = 0; y < cellH; y += step) for (let x = 0; x < cellW; x += step) {
            const a = pixels[((y + Math.floor(cell / columns) * cellH) * width + x + cell % columns * cellW) * 4 + 3];
            samples++; if (a < 32) clear++; if (a > 200) solid++;
        }
        if (clear < samples * .01 || solid < samples * .03) return 'Each slot needs one visible object and a transparent background. Ask the AI for true transparency, not a drawn checkerboard.';
    }
    return null;
}
