const buckets = new Map();

// Lightweight per-process IP limit. Use a shared store if the service is scaled horizontally.
function rateLimit({ windowMs, max }) {
    return (req, res, next) => {
        const now = Date.now();
        const key = `${req.ip}:${req.baseUrl}`;
        let bucket = buckets.get(key);
        if (!bucket || bucket.expiresAt <= now) {
            bucket = { count: 0, expiresAt: now + windowMs };
            buckets.set(key, bucket);
        }
        if (buckets.size > 10000) buckets.delete(buckets.keys().next().value);
        bucket.count++;
        res.set("RateLimit-Limit", String(max));
        res.set("RateLimit-Remaining", String(Math.max(0, max - bucket.count)));
        if (bucket.count > max) return res.status(429).json({ message: "Too many requests. Please wait and try again." });
        next();
    };
}

module.exports = rateLimit;
