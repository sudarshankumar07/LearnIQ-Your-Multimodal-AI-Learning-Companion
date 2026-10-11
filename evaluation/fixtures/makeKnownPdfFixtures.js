const fs = require("fs");
const path = require("path");

const fixtures = [
    {
        name: "known-facts-cedar.pdf",
        lines: ["Cedar: 40 ml water/day; 12 cm after 7 days; 6 h sun/day."]
    },
    {
        name: "known-facts-maple.pdf",
        lines: ["Maple: 20 ml water/day; 8 cm after 7 days; 6 h sun/day."]
    }
];

function makePdf(lines) {
    const escape = value => value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
    const stream = ["BT", "/F1 10 Tf", "50 740 Td", "18 TL", ...lines.flatMap((line, index) => index ? [`(${escape(line)}) Tj`, "T*"] : [`(${escape(line)}) Tj`]), "ET"].join("\n");
    const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`,
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
    ];
    let document = "%PDF-1.4\n%LearnIQ known facts fixture\n";
    const offsets = [0];
    objects.forEach((object, index) => {
        offsets.push(Buffer.byteLength(document, "ascii"));
        document += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xrefOffset = Buffer.byteLength(document, "ascii");
    document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets.slice(1)) document += `${String(offset).padStart(10, "0")} 00000 n \n`;
    document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return Buffer.from(document, "ascii");
}

function writeFixtures({ force = process.argv.includes("--force") } = {}) {
    const directory = __dirname;
    for (const fixture of fixtures) {
        const target = path.join(directory, fixture.name);
        if (fs.existsSync(target) && !force) throw new Error(`Refusing to overwrite existing fixture: ${fixture.name}`);
        fs.writeFileSync(target, makePdf(fixture.lines), { flag: force ? "w" : "wx" });
        console.log(`Created ${path.relative(process.cwd(), target)}`);
    }
}

if (require.main === module) writeFixtures();
module.exports = { fixtures, makePdf, writeFixtures };
