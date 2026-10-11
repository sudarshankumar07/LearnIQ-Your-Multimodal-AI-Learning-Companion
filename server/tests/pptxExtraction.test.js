const test = require("node:test");
const assert = require("node:assert/strict");
const { deflateRawSync } = require("node:zlib");
const { extractSlides, extractSlidesWithMedia } = require("../utils/extractPptxSlides");

function makeZip(files) {
    const localParts = [], centralParts = [];
    let localOffset = 0;
    for (const [name, text] of Object.entries(files)) {
        const nameBytes = Buffer.from(name), source = Buffer.from(text), compressed = deflateRawSync(source);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
        local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(source.length, 22); local.writeUInt16LE(nameBytes.length, 26);
        localParts.push(local, nameBytes, compressed);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
        central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(source.length, 24); central.writeUInt16LE(nameBytes.length, 28);
        central.writeUInt32LE(localOffset, 42);
        centralParts.push(central, nameBytes);
        localOffset += local.length + nameBytes.length + compressed.length;
    }
    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
    end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(localOffset, 16);
    return Buffer.concat([...localParts, ...centralParts, end]);
}

test("PPTX extraction preserves slide order and decodes text safely", () => {
    const zip = makeZip({
        "ppt/presentation.xml": "<p:presentation/>",
        "ppt/slides/slide2.xml": "<a:t>Second &amp; final</a:t>",
        "ppt/slides/slide1.xml": "<a:t>First slide</a:t><a:t>key idea</a:t>"
    });
    assert.deepEqual(extractSlides(zip), [
        { slideNumber: 1, text: "First slide key idea" },
        { slideNumber: 2, text: "Second & final" }
    ]);
});

test("PPTX extraction rejects a ZIP that is not a presentation", () => {
    assert.throws(() => extractSlides(makeZip({ "word/document.xml": "<a:t>nope</a:t>" })), /presentation/);
});

test("PPTX slide image relationships map to the correct slide and retain media bytes", () => {
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const slides = extractSlidesWithMedia(makeZip({
        "ppt/presentation.xml": "<p:presentation/>",
        "ppt/slides/slide1.xml": '<p:spTree><p:pic><p:blipFill><a:blip r:embed="rId1"/></p:blipFill></p:pic></p:spTree>',
        "ppt/slides/_rels/slide1.xml.rels": '<Relationships><Relationship Id="rId1" Target="../media/image1.png" Type="image"/></Relationships>',
        "ppt/media/image1.png": image
    }));
    assert.equal(slides[0].slideNumber, 1);
    assert.equal(slides[0].images.length, 1);
    assert.equal(slides[0].images[0].mimeType, "image/png");
    assert.deepEqual(slides[0].images[0].data, image);
});
