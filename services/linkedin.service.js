import axios from "axios";

const LI_AUTH = "https://www.linkedin.com/oauth/v2";
const LI_API = "https://api.linkedin.com/v2";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export function buildLinkedInAuthUrl(state) {
  const clientId = mustEnv("LINKEDIN_CLIENT_ID");
  const redirectUri = mustEnv("LINKEDIN_REDIRECT_URI");

  // Dev: publishing on your profile:
  // w_member_social is enough for posting.
  // If you want userinfo via OpenID, add: openid profile email
  const scope = "w_member_social openid profile email";
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: decodeURIComponent(scope), // keep spaces
  });

  // LinkedIn expects scope with spaces, URLSearchParams will encode it.
  return `${LI_AUTH}/authorization?${params.toString()}`;
}

export async function exchangeCodeForAccessToken(code) {
  const clientId = mustEnv("LINKEDIN_CLIENT_ID");
  const clientSecret = mustEnv("LINKEDIN_CLIENT_SECRET");
  const redirectUri = mustEnv("LINKEDIN_REDIRECT_URI");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const { data } = await axios.post(`${LI_AUTH}/accessToken`, body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  // data = { access_token, expires_in }
  return data;
}

// ✅ Get member id (person URN) using /me
export async function getLinkedInMemberId(accessToken) {
  // ✅ priorité à OpenID userinfo (souvent plus “autorisé” que /me sur apps récentes)
  try {
    const { data } = await axios.get(`${LI_API}/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 15000,
    });

    // data.sub est généralement l'identifiant membre
    if (data?.sub) return data.sub;
    console.log("🟡 userinfo sans sub:", data);
  } catch (e) {
    console.log("🟡 userinfo failed, fallback to /me:", e.response?.status, e.response?.data);
  }

  // fallback legacy
  const { data } = await axios.get(`${LI_API}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 15000,
  });
  return data.id;
}

// ✅ Publish a simple text post on member profile
export async function publishMemberPost({ accessToken, memberId, text }) {
  const payload = {
    author: `urn:li:person:${memberId}`,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text },
        shareMediaCategory: "NONE",
      },
    },
    visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
  };

  try {
    console.log("🔵 LinkedIn publish payload:", JSON.stringify(payload, null, 2));

    const res = await axios.post(`${LI_API}/ugcPosts`, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Restli-Protocol-Version": "2.0.0",
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });

    console.log("🟢 LinkedIn publish status:", res.status);
    console.log("🟢 LinkedIn publish data:", res.data);
    return res.data; // normalement contient un "id" (URN du post)
  } catch (err) {
    // IMPORTANT: LinkedIn met souvent les détails ici
    console.error("🔴 LinkedIn publish failed:", {
      message: err.message,
      status: err.response?.status,
      data: err.response?.data,
      headers: err.response?.headers,
    });
    throw err;
  }
}