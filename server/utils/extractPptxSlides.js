const { readZipEntries } = require("./zipEntries");
const path = require("path");

function decodeXml(text) {
    return text.replace(/&#x([\da-f]+);/gi, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_m, decimal) => String.fromCodePoint(parseInt(decimal, 10)))
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
function orderedSlides(entries) {
    if (!entries.has("ppt/presentation.xml")) throw new Error("The uploaded PPTX does not contain a presentation.");
    const slideTargets = new Map();
    const relationships = entries.get("ppt/_rels/presentation.xml.rels")?.toString("utf8") || "";
    for (const relation of relationships.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)) {
        const id = relation[1].match(/\bId="([^"]+)"/)?.[1];
        const target = relation[1].match(/\bTarget="([^"]+)"/)?.[1];
        if (!id || !target) continue;
        const resolved = path.posix.normalize(target.startsWith("/") ? target.slice(1) : path.posix.join("ppt", target));
        if (resolved.startsWith("ppt/slides/slide") && /^ppt\/slides\/slide\d+\.xml$/i.test(resolved)) slideTargets.set(id, resolved);
    }
    const order = [...entries.get("ppt/presentation.xml").toString("utf8").matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"[^>]*\/?\s*>/g)].map(match => slideTargets.get(match[1])).filter(Boolean);
    const slideFiles = order.length ? order : [...entries.keys()].filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
        .sort((a, b) => Number(a.match(/slide(\d+)\.xml/i)[1]) - Number(b.match(/slide(\d+)\.xml/i)[1]));
    if (!slideFiles.length || slideFiles.length > 500) throw new Error("PPTX must contain between 1 and 500 slides.");
    return slideFiles;
}
function extractSlides(buffer) {
    const entries = readZipEntries(buffer, name => name === "ppt/presentation.xml" || name === "ppt/_rels/presentation.xml.rels" || /^ppt\/slides\/slide\d+\.xml$/i.test(name));
    return orderedSlides(entries).map((name, index) => {
        const xml = entries.get(name).toString("utf8");
        const text = [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map(match => decodeXml(match[1])).join(" ").replace(/\s+/g, " ").trim();
        return { slideNumber: index + 1, text };
    });
}
function extractSlidesWithMedia(buffer) {
    const entries = readZipEntries(buffer, name =>
        name === "ppt/presentation.xml"
        || name === "ppt/_rels/presentation.xml.rels"
        || /^ppt\/slides\/slide\d+\.xml$/i.test(name)
        || /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/i.test(name)
        || /^ppt\/media\/[^/]+\.(png|jpe?g|gif|webp)$/i.test(name)
    );
    const mimeByExtension = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
    return orderedSlides(entries).map((name, index) => {
        const xml = entries.get(name).toString("utf8");
        const text = [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map(match => decodeXml(match[1])).join(" ").replace(/\s+/g, " ").trim();
        const relsPath = `ppt/slides/_rels/${name.split("/").pop()}.rels`;
        const relationships = entries.get(relsPath)?.toString("utf8") || "";
        const targets = new Map();
        for (const relation of relationships.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)) {
            const attributes = relation[1];
            if (/\bTargetMode="External"/i.test(attributes)) continue;
            const id = attributes.match(/\bId="([^"]+)"/)?.[1];
            const target = attributes.match(/\bTarget="([^"]+)"/)?.[1];
            if (!id || !target) continue;
            const resolved = path.posix.normalize(path.posix.join("ppt/slides", decodeXml(target)));
            if (resolved.startsWith("ppt/media/")) targets.set(id, resolved);
        }
        const images = [];
        for (const match of xml.matchAll(/<a:blip\b[^>]*\br:embed="([^"]+)"/g)) {
            const target = targets.get(match[1]);
            const data = target && entries.get(target);
            const extension = target && path.posix.extname(target).toLowerCase();
            if (data && mimeByExtension[extension]) images.push({ data, extension, mimeType: mimeByExtension[extension] });
        }
        return { slideNumber: index + 1, text, images };
    });
}
module.exports = { extractSlides, extractSlidesWithMedia };
