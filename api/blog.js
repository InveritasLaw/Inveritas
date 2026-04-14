var { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  var SUPABASE_URL = process.env.SUPABASE_URL;
  var SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  var sb = createClient(SUPABASE_URL, SUPABASE_KEY);

  try {
    // GET /api/blog?slug=xxx — single post by slug
    if (req.query.slug) {
      var { data: post, error } = await sb.from('blog_posts')
        .select('id, title, slug, excerpt, content, content_format, featured_image_url, author_name, author_title, category_id, published_at, meta_title, meta_description, og_image_url, reading_time_minutes, view_count, tags')
        .eq('slug', req.query.slug)
        .eq('status', 'published')
        .lte('published_at', new Date().toISOString())
        .single();

      if (error || !post) return res.status(404).json({ error: 'Post not found' });

      // Increment view count
      await sb.from('blog_posts')
        .update({ view_count: (post.view_count || 0) + 1 })
        .eq('id', post.id);

      // Get category name
      if (post.category_id) {
        var { data: cat } = await sb.from('blog_categories')
          .select('name, slug').eq('id', post.category_id).single();
        post.category = cat;
      }

      return res.status(200).json({ post: post });
    }

    // GET /api/blog — list published posts
    var page = parseInt(req.query.page) || 1;
    var perPage = parseInt(req.query.per_page) || 10;
    var from = (page - 1) * perPage;
    var to = from + perPage - 1;

    var q = sb.from('blog_posts')
      .select('id, title, slug, excerpt, featured_image_url, author_name, published_at, reading_time_minutes, view_count, tags, category_id', { count: 'exact' })
      .eq('status', 'published')
      .lte('published_at', new Date().toISOString())
      .order('published_at', { ascending: false })
      .range(from, to);

    if (req.query.category) {
      q = q.eq('category_id', req.query.category);
    }
    if (req.query.tag) {
      q = q.contains('tags', [req.query.tag]);
    }

    var { data: posts, count, error } = await q;
    if (error) throw error;

    // Get categories
    var { data: categories } = await sb.from('blog_categories')
      .select('id, name, slug').order('name');

    return res.status(200).json({
      posts: posts || [],
      total: count || 0,
      page: page,
      per_page: perPage,
      categories: categories || []
    });

  } catch (err) {
    console.error('Blog API error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
