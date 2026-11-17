const {setGlobalOptions} = require("firebase-functions");
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const Stripe = require("stripe");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");

setGlobalOptions({ maxInstances: 10 });

if (!admin.apps.length) {
  admin.initializeApp();
}

// Helper to initialize Stripe only when a function is called
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("Missing STRIPE_SECRET_KEY environment variable.");
  }
  return new Stripe(key);
}

// 1. Create Checkout Session
// 1. Create Checkout Session (v2 Public HTTP)
exports.createCheckoutSession = onRequest({ invoker: "public" }, async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "POST");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).send("");
    return;
  }

  const stripe = getStripe();
  const { email, username, poemLink, contestId, entryFee, successUrl, cancelUrl } = req.body.data || req.body;

  try {
    const entryRef = admin.database().ref(`contests/${contestId}/entries`).push();
    const entryId = entryRef.key;

    await entryRef.set({
      email,
      username,
      poemLink,
      status: "pending_payment",
      submittedAt: admin.database.ServerValue.TIMESTAMP
    });

    const session = await stripe.checkout.sessions.create({
  // REMOVE THIS LINE: payment_method_types: ["card"],
  customer_email: email,
  line_items: [{
    price_data: {
      currency: "usd",
      product_data: {
        name: "SpokenWords Poetry Contest Entry",
        description: `Contest Entry for ${username}`
      },
      unit_amount: Math.round(entryFee * 100),
    },
    quantity: 1,
  }],
  mode: "payment",
  success_url: `${successUrl}&session_id={CHECKOUT_SESSION_ID}&entry_id=${entryId}`,
  cancel_url: cancelUrl,
  metadata: { contestId, entryId }
});

    res.status(200).json({ result: { checkoutUrl: session.url } });
  } catch (error) {
    console.error("Stripe Checkout Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 3. Existing Sitemap Function
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
      urls.push(
        `<url><loc>${baseUrl}/profile/${uid}</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>`
      );

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
    res.set("Cache-Control", "public, max-age=43200, s-maxage=43200");
    return res.status(200).send(xml);
  } catch (error) {
    console.error("Sitemap error:", error);
    return res.status(500).send("Error generating sitemap");
  }
});