const express = require("express");
const multer = require("multer");
const {PDFParse} = require("pdf-parse");
const fs  = require("fs");
const { randomUUID } = require("crypto");
const {GoogleGenAI} = require("@google/genai");
const {QdrantClient} = require("@qdrant/js-client-rest");

require('dotenv').config();

const app = express();
const port = 3000;
const path = require("path");
const methodOverride = require("method-override");
const { url } = require("inspector");
const upload = multer({dest:"uploads/"});
app.use(methodOverride("_method"));

app.set("view engine","ejs");
app.set("views",path.join(__dirname,"views"));

app.use(express.static(path.join(__dirname,"public")));
app.use(express.json());
app.use(express.urlencoded({extended : true}));

const ai = new GoogleGenAI({
    apiKey : process.env.GEMINI_API_KEY
})
const qdrant = new QdrantClient({
    url: process.env.QDRANT_URL,
    apiKey : process.env.QDRANT_API_KEY
})
async function setupQdrant() {
    try{
        
        await qdrant.createCollection("pdf_chunks",{
            vectors:{
                size : 3072,
                distance : "Cosine"
            }
        })

    }catch(err){
        console.log("Qdrant setup : ", err.message)
    }
}
setupQdrant()
// 1. CREATE EMBEDDING

async function createEmbedding(text) {
    if (!text || !text.trim()) {
        throw new Error("Cannot create embedding for empty text");
    }

    const response = await ai.models.embedContent({
        model: "gemini-embedding-2",
        contents: text,
    });

    const embedding = response?.embeddings?.[0]?.values;

    if (!embedding || !Array.isArray(embedding)) {
        throw new Error("Invalid embedding response from Gemini");
    }

    return embedding;
}

// 2. CREATE CHUNKS

function createChunks(text, maxWords = 500, overlapWords = 50) {
    if (!text || !text.trim()) {
        return [];
    }
    // Normalize whitespace
    const cleanedText = text
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .trim();
    // Try to preserve paragraph boundaries
    const paragraphs = cleanedText
        .split(/\n\s*\n/)
        .map(paragraph => paragraph.trim())
        .filter(Boolean);
    const chunks = [];
    let currentChunk = [];
    let currentWords = 0;
    for (const paragraph of paragraphs) {
        const paragraphWords = paragraph.split(/\s+/);
        // If adding this paragraph exceeds the limit,
        // save the current chunk first.
        if (
            currentWords + paragraphWords.length > maxWords &&
            currentChunk.length > 0
        ) {
            const chunkText = currentChunk.join("\n\n");
            chunks.push(chunkText);
            // Create overlap from the end of previous chunk
            const overlap = chunkText
                .split(/\s+/)
                .slice(-overlapWords)
                .join(" ");
            currentChunk = [overlap];
            currentWords = overlapWords;
        }
        currentChunk.push(paragraph);
        currentWords += paragraphWords.length;
    }
    // Add final chunk
    if (currentChunk.length > 0) {
        chunks.push(currentChunk.join("\n\n"));
    }
    return chunks
        .map(chunk => chunk.trim())
        .filter(Boolean);
}

// 3. PROCESS PDF

async function processPDF(filePath) {

    let parser;
    try {
        // Read PDF
        const dataBuffer = fs.readFileSync(filePath);
        if (!dataBuffer || dataBuffer.length === 0) {
            return {
                success: false,
                type: "EMPTY_FILE",
                message: "Uploaded PDF file is empty."
            };
        }
        // Create PDF parser
        parser = new PDFParse({
            data: dataBuffer
        });
        // Extract text
        const pdfData = await parser.getText();
        const text = pdfData.text?.trim();
        
        // PDF opened but no text was extracted
        if (!text) {
            return {
                success: false,
                type: "NO_TEXT",
                message:
                    "PDF was opened successfully, but no extractable text was found. It may be a scanned/image-based PDF and require OCR."
            };
        }
        // Create chunks
        
        const chunks = createChunks(text);
        if (chunks.length === 0) {
            return {
                success: false,
                type: "NO_CHUNKS",
                message: "Text was extracted but no chunks could be created."
            };
        }

        // Generate ONE embedding per chunk
        const points = [];
        for (let i = 0; i < chunks.length; i++) {

            const chunkText = chunks[i];

            const embedding = await createEmbedding(chunkText);

            points.push({
                id: randomUUID(),
                vector: embedding,
                payload: {
                    text: chunkText,
                    chunkIndex: i
                }
            });
        }

        // Store vectors in Qdrant
        await qdrant.upsert("pdf_chunks", {
            wait: true,
            points: points
        });

        // Return final result
        return {
        success: true,
        type: "TEXT",
        pages: pdfData.total,
        totalChunks: chunks.length
        };
    } catch (error) {

        console.error("PDF processing failed:", error);
        return {
            success: false,
            type: "PDF_PARSE_ERROR",
            message: error.message || "Failed to process PDF."
        };

    } finally {

        // Always release parser resources
        if (parser) {
            try {
                await parser.destroy();
            } catch (destroyError) {
                console.error(
                    "Failed to destroy PDF parser:",
                    destroyError
                );
            }
        }
    }
}


async function semanticSearch(query, topK = 3) {

    const queryEmbedding = await createEmbedding(query);

    const result = await qdrant.query("pdf_chunks", {
        query: queryEmbedding,
        limit: topK,
        with_payload: true
    });

    return result.points;
}
//API Routes

app.get("/",(req,res)=>{
    res.send("nothing......")
})

app.post('/upload',upload.single('pdf'), async(req,res)=>{
    
    try{
        if (!req.file) {
            return res.status(400).json({
                success: false,
                type: "NO_FILE",
                message: "Please upload a PDF file."
            });
        }

       const result = await processPDF(req.file.path);

        if (!result.success) {
            return res.status(400).json(result);
        }
        res.status(200).json(result);

    }catch(err){
        console.log(err);
        res.status(500).send(err)
    }
})

app.post('/ask', async(req,res)=>{
    try{
        const query = req.body.query;

        if (typeof query !== "string" || !query.trim()) {
            return res.status(400).json({
                success: false,
                message: "Please provide a question in the query field."
            });
        }

        const releventChunks = await semanticSearch(query, 3);
        const context = releventChunks.map(chunk => chunk.payload.text).join('\n\n');
        const respone = await ai.models.generateContent({
            model : 'gemini-3.5-flash-lite',
            contents : `explain the pdf in easy way : ${query}, ${context}`
        });

        res.send(respone.text);
    }catch(err){
        console.log(err);
        res.status(500).send(err)
    }
})
app.listen(port,()=>{
    console.log(`server is online on port ${port}`)
})
