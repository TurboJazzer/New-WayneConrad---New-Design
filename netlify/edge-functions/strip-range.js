export default async (request, context) => {
  const userAgent = request.headers.get("user-agent") || "";

  // Target LinkedInBot (and other social crawlers) sending byte-range requests
  if (userAgent.toLowerCase().includes("linkedinbot") || userAgent.toLowerCase().includes("facebookexternalhit")) {
    const newHeaders = new Headers(request.headers);
    newHeaders.delete("range"); // Remove Range header so Netlify returns a 200 OK

    const modifiedRequest = new Request(request, {
      headers: newHeaders,
    });

    return await context.next(modifiedRequest);
  }

  return await context.next();
};
