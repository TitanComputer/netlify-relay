/* Define the destination domain from environment variables */
const DESTINATION_ORIGIN = (Netlify.env.get("DOM_TAR") || "").replace(/\/$/, "");

/* Headers that should be removed to avoid conflicts or security issues */
const BLOCKED_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
]);

export default async function handler(incomingRequest) {
  /* Validate if the destination domain is configured */
  if (!DESTINATION_ORIGIN) {
    return new Response("Misconfigured: DOM_TAR is not set", { status: 500 });
  }

  try {
    /* Construct the full URL for the upstream request */
    const currentUrl = new URL(incomingRequest.url);
    const proxyTarget = DESTINATION_ORIGIN + currentUrl.pathname + currentUrl.search;

    const requestHeaders = new Headers();
    let visitorIp = null;

    /* Process and filter incoming headers */
    for (const [name, val] of incomingRequest.headers) {
      const lowerName = name.toLowerCase();
      
      if (BLOCKED_HEADERS.has(lowerName)) continue;
      if (lowerName.startsWith("x-nf-")) continue;
      if (lowerName.startsWith("x-netlify-")) continue;
      
      /* Extract client IP for forwarding */
      if (lowerName === "x-real-ip") {
        visitorIp = val;
        continue;
      }
      if (lowerName === "x-forwarded-for") {
        if (!visitorIp) visitorIp = val;
        continue;
      }
      requestHeaders.set(lowerName, val);
    }

    /* Set the forwarded IP if it exists */
    if (visitorIp) requestHeaders.set("x-forwarded-for", visitorIp);

    /* Determine if the request contains a payload */
    const httpMethod = incomingRequest.method;
    const containsPayload = httpMethod !== "GET" && httpMethod !== "HEAD";

    const transmissionSettings = {
      method: httpMethod,
      headers: requestHeaders,
      redirect: "manual",
    };

    /* Attach the body if the request method supports it */
    if (containsPayload) {
      transmissionSettings.body = incomingRequest.body;
    }

    /* Perform the request to the upstream server */
    const upstreamResponse = await fetch(proxyTarget, transmissionSettings);

    /* Filter and prepare response headers to send back to client */
    const outgoingHeaders = new Headers();
    for (const [headerKey, headerValue] of upstreamResponse.headers) {
      if (headerKey.toLowerCase() === "transfer-encoding") continue;
      outgoingHeaders.set(headerKey, headerValue);
    }

    /* Return the final response with the original body and status */
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: outgoingHeaders,
    });
  } catch (err) {
    /* Handle connection errors */
    return new Response("Bad Gateway: Relay Failed", { status: 502 });
  }
}
