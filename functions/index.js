/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const {setGlobalOptions} = require("firebase-functions");
const {onRequest} = require("firebase-functions/https");
const logger = require("firebase-functions/logger");

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
setGlobalOptions({ maxInstances: 10 });

const functions = require("firebase-functions");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

exports.sitemap = functions.https.onRequest(async (req, res) => {
  const baseUrl = "https://spoken-words-d16b8.web.app";
  const db = admin.database();

  try {
    const snapshot = await db.ref("users").once("value");
    const users = snapshot.val() || {};

    let urls = [
      `<url><loc>${baseUrl}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>`
    ];

    for (const [uid, userData] of Object.entries(users)) {
      // 1. Add Profile URL
      urls.push(
        `<url><loc>${baseUrl}/profile/${uid}</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>`
      );

      // 2. Add Public Poems URLs
      if (userData.poems) {
        for (const [poemTitle, poemData] of Object.entries(userData.poems)) {
          if (!poemData.isPrivate) {
            const encodedTitle = encodeURIComponent(poemTitle);
            urls.push(
              `<url><loc>${baseUrl}/poem/${uid}/${encodedTitle}</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>`
            );
          }
        }
      }
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>`;

    res.set("Content-Type", "application/xml");
    // Cache on CDN for 12 hours to avoid hammering your DB
    res.set("Cache-Control", "public, max-age=43200, s-maxage=43200");
    return res.status(200).send(xml);
  } catch (error) {
    console.error("Sitemap error:", error);
    return res.status(500).send("Error generating sitemap");
  }
});
