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
    const { q, maxResults = 10, type = 'video', part = 'snippet' } = req.body;
    
    if (!q || !q.trim()) {
      return res.status(400).json({ error: 'Missing required parameter: q' });
    }

    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'YOUTUBE_API_KEY not configured' });
    }

    // STEP 1: Search for videos
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=${type}&q=${encodeURIComponent(q)}&maxResults=${maxResults}&key=${apiKey}`;
    
    const searchResponse = await fetch(searchUrl);
    const searchData = await searchResponse.json();

    if (!searchData.items || searchData.items.length === 0) {
      return res.status(200).json({
        items: [],
        videos: [],
        totalResults: 0
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
        totalResults: 0
      });
    }

    // STEP 3: Get video statistics
    const videosUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet,contentDetails&id=${videoIds.join(',')}&key=${apiKey}`;
    
    const videosResponse = await fetch(videosUrl);
    const videosData = await videosResponse.json();

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
        url: `https://youtube.com/watch?v=${videoId}`
      };
    });

    // STEP 5: Return enriched data with full compatibility
    return res.status(200).json({
      items: combinedItems,
      videos: combinedItems,  // Same data, different field name for compatibility
      totalResults: searchData.pageInfo?.totalResults || combinedItems.length,
      searchInfo: {
        query: q,
        resultsPerPage: searchData.pageInfo?.resultsPerPage || maxResults
      }
    });
    
  } catch (error) {
    console.error('YouTube API error:', error);
    return res.status(500).json({ 
      error: 'YouTube API error',
      details: error.message 
    });
  }
}
