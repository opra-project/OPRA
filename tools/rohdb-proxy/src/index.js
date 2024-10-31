export default {
  async fetch(request, env, ctx) {
  console.log("fetch: " + request.url)
  return await handleRequest(request, env, ctx);
  }
}

async function handleRequest(request, env, ctx) {
  const cacheUrl = new URL(request.url)

  const cacheKey = new Request(cacheUrl.toString(), request)
  const cache = caches.default

  // Try to find the response in the cache
  let response = await cache.match(cacheKey)
  if (response) {
    // If we have a cached response, check if the client has sent conditional headers
    const ifNoneMatch = request.headers.get('If-None-Match')
    const etag = response.headers.get('ETag')

    const ifModifiedSince = request.headers.get('If-Modified-Since')
    const lastModified = response.headers.get('Last-Modified')

    let notModified = false

    if (ifNoneMatch && etag && ifNoneMatch === etag) {
      notModified = true
    } else if (ifModifiedSince && lastModified) {
      const ifModifiedSinceTime = new Date(ifModifiedSince).getTime()
      const lastModifiedTime = new Date(lastModified).getTime()
      if (ifModifiedSinceTime >= lastModifiedTime) {
        notModified = true
      }
    }

    if (notModified) {
      // Return 304 Not Modified
      console.log("  return 304 not modified")
      return new Response(null, {
        status: 304,
        headers: {
          'ETag': etag,
          'Last-Modified': lastModified,
          'Cache-Control': response.headers.get('Cache-Control'),
        }
      })
    }
    console.log("  return data from cache")

    // Otherwise, return the cached response
    return response
  }

  // If not in cache, fetch from GitHub
  const url = new URL(request.url)
  const pathname = url.pathname

  if (pathname.includes('..')) {
    return new Response('Invalid path', { status: 400 })
  }

  // Map the incoming request path to the GitHub raw content URL
  const githubUrl = `https://raw.githubusercontent.com/blucz/RoonOpenHeadphonesDb/main/dist${pathname}`

  console.log("  fetching from " + githubUrl);

  // Create a new request to GitHub
  const githubRequest = new Request(githubUrl, {
    method: 'GET',
    headers: {
      'User-Agent': 'Cloudflare-Worker',
      'If-None-Match': request.headers.get('If-None-Match'),
      'If-Modified-Since': request.headers.get('If-Modified-Since'),
    },
    redirect: 'follow',
  })

  // Fetch from GitHub
  let githubResponse = await fetch(githubRequest)

  if (githubResponse.status === 304 && response) {
    // GitHub says content not modified, and we have a cached response
    // Return the cached response
    console.log("  got 304 from github, returning cached response")
    return response
  } else if (githubResponse.status === 200) {
    // Clone the response before adding it to cache
    const responseToCache = githubResponse.clone()

    // Store the response in the cache
    ctx.waitUntil(cache.put(cacheKey, responseToCache))

    // Return the response
    console.log("  got 200 from github, returning response")
    return githubResponse
  } else {
    // Return the response as is (e.g., 404 or other errors)
    console.log("  got error from github, returning response")
    return githubResponse
  }
}
