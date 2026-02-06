export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-License-Key');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // License validation
  const licenseKey = req.headers['x-license-key'];
  if (!licenseKey) {
    return res.status(401).json({ error: 'License key required' });
  }

  try {
    const { q, maxResults = 10, type = 'video', part = 'snippet', publishedAfter, publishedBefore, days = 60, samples = 8, order = 'date' } = req.body;
    
    if (!q || !q.trim()) {
      return res.status(400).json({ error: 'Missing required parameter: q' });
    }

    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'YOUTUBE_API_KEY not configured' });
    }

    // Track whether we used a single search URL or sampled dates so responses can include metadata
    let usedSearchUrl = null;
    let sampledDates = null;

    // If explicit date range provided, perform a single search as before.
    let searchData = null;

    if (publishedAfter || publishedBefore) {
      // Single-query path
      let searchUrl = `https://www.googleapis.com/youtube/v3/search?part=${part}&type=${type}&q=${encodeURIComponent(q)}&maxResults=${maxResults}&key=${apiKey}`;
      if (publishedAfter) searchUrl += `&publishedAfter=${encodeURIComponent(publishedAfter)}`;
      if (publishedBefore) searchUrl += `&publishedBefore=${encodeURIComponent(publishedBefore)}`;
      searchUrl += `&order=${order}`;

      console.log(`YouTube API Call: ${searchUrl}`);
      if (publishedAfter) console.log(`Filtering videos published after: ${publishedAfter}`);

      // Record metadata for response
      usedSearchUrl = searchUrl;
      sampledDates = (publishedAfter || publishedBefore) ? [publishedAfter || null, publishedBefore || null] : null;

      const searchResponse = await fetch(searchUrl);
      searchData = await searchResponse.json();
    } else {
      // Default behavior: sample random days in the last `days` window and aggregate results
      const daysWindow = Math.max(1, Math.min(days, 365));
      const sampleCount = Math.max(1, Math.min(samples, 20));
      const now = new Date();
      const startWindow = new Date(now.getTime() - daysWindow * 24 * 60 * 60 * 1000);

      // Generate unique random day strings (YYYY-MM-DD)
      const generated = new Set();
      const randDays = [];
      while (randDays.length < sampleCount) {
        const rand = new Date(startWindow.getTime() + Math.floor(Math.random() * (now.getTime() - startWindow.getTime())));
        const dayStr = rand.toISOString().slice(0, 10);
        if (!generated.has(dayStr)) {
          generated.add(dayStr);
          randDays.push(dayStr);
        }
      }

      console.log(`YouTube sampling over last ${daysWindow} days using ${randDays.length} sample days: ${randDays.join(',')}`);

      // Save sampled dates for response metadata
      sampledDates = randDays.slice();

      const searchPromises = randDays.map(dayStr => {
        const dayStart = new Date(dayStr + 'T00:00:00Z').toISOString();
        const dayEnd = new Date(new Date(dayStr + 'T00:00:00Z').getTime() + 24 * 60 * 60 * 1000).toISOString();
        let url = `https://www.googleapis.com/youtube/v3/search?part=${part}&type=${type}&q=${encodeURIComponent(q)}&maxResults=${maxResults}&key=${apiKey}`;
        url += `&publishedAfter=${encodeURIComponent(dayStart)}&publishedBefore=${encodeURIComponent(dayEnd)}&order=${order}`;
        console.log(`YouTube sample call: ${url}`);
        return fetch(url).then(r => r.json()).catch(err => ({ error: err }));
      });

      const sampleResults = (await Promise.all(searchPromises)).filter(r => r && !r.error);
      const allItems = sampleResults.flatMap(r => r.items || []);

      // Deduplicate by video id
      const itemsById = new Map();
      for (const item of allItems) {
        const id = item.id?.videoId || (item.id && (item.id.videoId || item.id));
        if (id && !itemsById.has(id)) itemsById.set(id, item);
      }

      const aggregatedItems = Array.from(itemsById.values());
      searchData = { items: aggregatedItems, pageInfo: { totalResults: aggregatedItems.length, resultsPerPage: maxResults } };
    }

    // Check for API errors
    if (searchData.error) {
      console.error('YouTube API error:', searchData.error);
      return res.status(500).json({ 
        error: 'YouTube API error',
        details: searchData.error.message || 'Unknown API error'
      });
    }

    if (!searchData.items || searchData.items.length === 0) {
      return res.status(200).json({
        items: [],
        videos: [],
        totalResults: 0,
        searchInfo: {
          query: q,
          resultsPerPage: maxResults,
          publishedAfter: publishedAfter || null,
          order: order,
          sampledDates: sampledDates || null
        },
        apiInfo: {
          searchUrl: usedSearchUrl ? usedSearchUrl.split('key=')[0] + 'key=[REDACTED]' : (sampledDates ? `sampled:${sampledDates.join(',')}` : 'unknown'),
          timestamp: new Date().toISOString()
        }
      });
    }

    // STEP 2: Extract video IDs
    const videoIds = searchData.items
      .map(item => item.id.videoId)
      .filter(Boolean);

    if (videoIds.length === 0) {
      return res.status(200).json({
        items: [],
        videos: [],
        totalResults: 0,
        searchInfo: {
          query: q,
          resultsPerPage: maxResults,
          publishedAfter: publishedAfter || null,
          order: order,
          sampledDates: sampledDates || null
        },
        apiInfo: {
          searchUrl: usedSearchUrl ? usedSearchUrl.split('key=')[0] + 'key=[REDACTED]' : (sampledDates ? `sampled:${sampledDates.join(',')}` : 'unknown'),
          timestamp: new Date().toISOString()
        }
      });
    }

    // STEP 3: Get video statistics
    const videosUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet,contentDetails&id=${videoIds.join(',')}&key=${apiKey}`;
    
    const videosResponse = await fetch(videosUrl);
    const videosData = await videosResponse.json();

    // Check for API errors in videos endpoint
    if (videosData.error) {
      console.error('YouTube Videos API error:', videosData.error);
      // Still return search results without statistics
      const combinedItems = searchData.items.map(searchItem => {
        const videoId = searchItem.id.videoId;
        
        return {
          id: videoId,
          snippet: searchItem.snippet,
          statistics: { viewCount: '0', likeCount: '0', commentCount: '0' },
          contentDetails: {},
          viewCount: '0',
          views: '0',
          title: searchItem.snippet?.title,
          channel: searchItem.snippet?.channelTitle,
          publishedAt: searchItem.snippet?.publishedAt,
          url: `https://youtube.com/watch?v=${videoId}`
        };
      });

      const apiSearchUrl = usedSearchUrl ? usedSearchUrl.split('key=')[0] + 'key=[REDACTED]' : (sampledDates ? `sampled:${sampledDates.join(',')}` : 'unknown');
      return res.status(200).json({
        items: combinedItems,
        videos: combinedItems,
        totalResults: searchData.pageInfo?.totalResults || combinedItems.length,
        searchInfo: {
          query: q,
          resultsPerPage: searchData.pageInfo?.resultsPerPage || maxResults,
          publishedAfter: publishedAfter || null,
          order: order,
          sampledDates: sampledDates || null,
          note: 'Statistics unavailable'
        },
        apiInfo: {
          searchUrl: apiSearchUrl,
          timestamp: new Date().toISOString()
        }
      });
    }

    // STEP 4: Combine search results with statistics
    const combinedItems = searchData.items.map(searchItem => {
      const videoId = searchItem.id.videoId;
      const videoStats = videosData.items?.find(v => v.id === videoId);
      const viewCount = videoStats?.statistics?.viewCount || '0';
      
      return {
        id: videoId,
        snippet: searchItem.snippet,
        statistics: videoStats?.statistics || { viewCount: '0', likeCount: '0', commentCount: '0' },
        contentDetails: videoStats?.contentDetails || {},
        // KEY: Add BOTH fields for compatibility
        viewCount: viewCount,
        views: viewCount,
        // Additional fields for easier access
        title: searchItem.snippet?.title,
        channel: searchItem.snippet?.channelTitle,
        publishedAt: searchItem.snippet?.publishedAt,
        url: `https://youtube.com/watch?v=${videoId}`,
        // Add duration if available
        duration: videoStats?.contentDetails?.duration || null
      };
    });

    // STEP 5: Filter by date client-side as additional safeguard
    let filteredItems = combinedItems;
    if (publishedAfter) {
      const filterDate = new Date(publishedAfter);
      filteredItems = combinedItems.filter(item => {
        try {
          const publishedDate = new Date(item.publishedAt);
          return publishedDate >= filterDate;
        } catch (e) {
          // If date parsing fails, include the item
          console.warn(`Failed to parse date: ${item.publishedAt}`);
          return true;
        }
      });
      
      console.log(`Date filtering: ${combinedItems.length} total, ${filteredItems.length} after ${publishedAfter}`);
    }

    // STEP 6: Return enriched data with full compatibility
    const apiSearchUrlFinal = usedSearchUrl ? usedSearchUrl.split('key=')[0] + 'key=[REDACTED]' : (sampledDates ? `sampled:${sampledDates.join(',')}` : 'unknown');
    return res.status(200).json({
      items: filteredItems,
      videos: filteredItems,  // Same data, different field name for compatibility
      totalResults: searchData.pageInfo?.totalResults || filteredItems.length,
      filteredResults: filteredItems.length,
      searchInfo: {
        query: q,
        resultsPerPage: searchData.pageInfo?.resultsPerPage || maxResults,
        publishedAfter: publishedAfter || null,
        order: order,
        totalAvailable: searchData.pageInfo?.totalResults || 0,
        dateFilterApplied: !!publishedAfter,
        sampledDates: sampledDates || null
      },
      apiInfo: {
        searchUrl: apiSearchUrlFinal,
        videosUrl: videosUrl.split('key=')[0] + 'key=[REDACTED]',
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('YouTube API error:', error);
    return res.status(500).json({ 
      error: 'YouTube API error',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
}
