var { createClient } = require('@supabase/supabase-js');

var ADMIN_EMAIL = 'glossontravis@gmail.com';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://inveritaslaw.com');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  var SUPABASE_URL = process.env.SUPABASE_URL;
  var SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  var authHeader = req.headers.authorization || '';
  var token = authHeader.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  var sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  var authResult = await sb.auth.getUser(token);
  if (authResult.error || !authResult.data.user) {
    return res.status(401).json({ error: 'Invalid session' });
  }

  var user = authResult.data.user;
  var userId = user.id;
  var userEmail = user.email;

  // Admin check — only glossontravis@gmail.com or users in admin_roles
  if (userEmail !== ADMIN_EMAIL) {
    var { data: adminCheck } = await sb.from('admin_roles')
      .select('role').eq('user_id', userId).single();
    if (!adminCheck) {
      return res.status(403).json({ error: 'Admin access required' });
    }
  }

  var ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';
  var action = req.query.action || req.body?.action;

  try {
    // ===== STATS =====
    if (action === 'stats') {
      var stats = await sb.rpc('admin_get_stats');
      return res.status(200).json({ stats: stats.data || {} });
    }

    // ===== LIST USERS =====
    if (action === 'users' && req.method === 'GET') {
      var page = parseInt(req.query.page) || 1;
      var perPage = parseInt(req.query.per_page) || 50;
      var from = (page - 1) * perPage;
      var to = from + perPage - 1;

      var q = sb.from('user_profiles')
        .select('*, cases:cases(count)', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);

      if (req.query.tier) q = q.eq('subscription_tier', req.query.tier);
      if (req.query.search) q = q.ilike('email', '%' + req.query.search + '%');

      var { data: users, count, error } = await q;
      if (error) throw error;

      return res.status(200).json({
        users: users || [],
        total: count || 0,
        page: page,
        per_page: perPage
      });
    }

    // ===== GET SINGLE USER =====
    if (action === 'user' && req.method === 'GET') {
      var targetUserId = req.query.user_id;
      if (!targetUserId) return res.status(400).json({ error: 'user_id required' });

      var { data: profile } = await sb.from('user_profiles')
        .select('*').eq('user_id', targetUserId).single();

      var { data: userCases } = await sb.from('cases')
        .select('id, case_number, title, status, charge, created_at')
        .eq('user_id', targetUserId)
        .order('created_at', { ascending: false })
        .limit(20);

      var { data: recentEvents } = await sb.from('event_logs')
        .select('event_type, metadata, created_at')
        .eq('user_id', targetUserId)
        .order('created_at', { ascending: false })
        .limit(50);

      return res.status(200).json({
        profile: profile,
        cases: userCases || [],
        events: recentEvents || []
      });
    }

    // ===== UPDATE USER SUBSCRIPTION =====
    if (action === 'update_user' && req.method === 'PUT') {
      var body = req.body || {};
      var targetUserId = body.user_id;
      if (!targetUserId) return res.status(400).json({ error: 'user_id required' });

      var updates = {};
      if (body.subscription_tier) updates.subscription_tier = body.subscription_tier;
      if (body.analyses_this_month !== undefined) updates.analyses_this_month = parseInt(body.analyses_this_month);

      var { data, error } = await sb.from('user_profiles')
        .update(updates).eq('user_id', targetUserId).select().single();
      if (error) throw error;

      await logAudit(sb, userId, userEmail, 'update_user_subscription', 'user', targetUserId, updates, ip);

      return res.status(200).json({ profile: data });
    }

    // ===== BLOG: LIST ALL POSTS (including drafts) =====
    if (action === 'blog_list' && req.method === 'GET') {
      var { data: posts, error } = await sb.from('blog_posts')
        .select('id, title, slug, status, published_at, view_count, category_id, tags, created_at, updated_at')
        .order('updated_at', { ascending: false });
      if (error) throw error;

      return res.status(200).json({ posts: posts || [] });
    }

    // ===== BLOG: GET SINGLE POST =====
    if (action === 'blog_get' && req.method === 'GET') {
      var postId = req.query.post_id;
      if (!postId) return res.status(400).json({ error: 'post_id required' });

      var { data: post, error } = await sb.from('blog_posts')
        .select('*').eq('id', postId).single();
      if (error) throw error;

      return res.status(200).json({ post: post });
    }

    // ===== BLOG: CREATE POST =====
    if (action === 'blog_create' && req.method === 'POST') {
      var body = req.body || {};
      var title = String(body.title || '').slice(0, 200);
      if (!title) return res.status(400).json({ error: 'Title required' });

      var slug = body.slug || title.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 100);

      var newPost = {
        title: title,
        slug: slug,
        excerpt: body.excerpt ? String(body.excerpt).slice(0, 500) : null,
        content: String(body.content || '').slice(0, 50000),
        content_format: body.content_format || 'markdown',
        featured_image_url: body.featured_image_url || null,
        author_name: body.author_name || 'Travis Glosson',
        author_title: body.author_title || 'Founder, Inveritas',
        category_id: body.category_id || null,
        status: body.status || 'draft',
        published_at: body.status === 'published' ? new Date().toISOString() : null,
        meta_title: body.meta_title || title,
        meta_description: body.meta_description || (body.excerpt || '').slice(0, 160),
        tags: Array.isArray(body.tags) ? body.tags.slice(0, 10) : [],
        reading_time_minutes: Math.ceil((body.content || '').split(/\s+/).length / 200) || 5
      };

      var { data: post, error } = await sb.from('blog_posts')
        .insert(newPost).select().single();
      if (error) throw error;

      await logAudit(sb, userId, userEmail, 'blog_create', 'blog_post', post.id, { title: title }, ip);

      return res.status(201).json({ post: post });
    }

    // ===== BLOG: UPDATE POST =====
    if (action === 'blog_update' && req.method === 'PUT') {
      var body = req.body || {};
      var postId = body.post_id || req.query.post_id;
      if (!postId) return res.status(400).json({ error: 'post_id required' });

      var updates = {};
      if (body.title) updates.title = String(body.title).slice(0, 200);
      if (body.slug) updates.slug = String(body.slug).slice(0, 100);
      if (body.excerpt !== undefined) updates.excerpt = body.excerpt ? String(body.excerpt).slice(0, 500) : null;
      if (body.content !== undefined) updates.content = String(body.content).slice(0, 50000);
      if (body.featured_image_url !== undefined) updates.featured_image_url = body.featured_image_url;
      if (body.category_id !== undefined) updates.category_id = body.category_id;
      if (body.tags) updates.tags = Array.isArray(body.tags) ? body.tags.slice(0, 10) : [];
      if (body.meta_title) updates.meta_title = String(body.meta_title).slice(0, 200);
      if (body.meta_description) updates.meta_description = String(body.meta_description).slice(0, 160);

      if (body.status) {
        updates.status = body.status;
        if (body.status === 'published' && !body.published_at) {
          updates.published_at = new Date().toISOString();
        }
      }

      if (body.content) {
        updates.reading_time_minutes = Math.ceil(body.content.split(/\s+/).length / 200) || 5;
      }

      var { data: post, error } = await sb.from('blog_posts')
        .update(updates).eq('id', postId).select().single();
      if (error) throw error;

      await logAudit(sb, userId, userEmail, 'blog_update', 'blog_post', postId, { title: post.title, status: post.status }, ip);

      return res.status(200).json({ post: post });
    }

    // ===== BLOG: DELETE POST =====
    if (action === 'blog_delete' && req.method === 'DELETE') {
      var postId = req.query.post_id;
      if (!postId) return res.status(400).json({ error: 'post_id required' });

      var { error } = await sb.from('blog_posts').delete().eq('id', postId);
      if (error) throw error;

      await logAudit(sb, userId, userEmail, 'blog_delete', 'blog_post', postId, {}, ip);

      return res.status(200).json({ deleted: true });
    }

    // ===== BLOG: MANAGE CATEGORIES =====
    if (action === 'blog_categories') {
      if (req.method === 'GET') {
        var { data: cats } = await sb.from('blog_categories').select('*').order('name');
        return res.status(200).json({ categories: cats || [] });
      }
      if (req.method === 'POST') {
        var body = req.body || {};
        var name = String(body.name || '').slice(0, 100);
        if (!name) return res.status(400).json({ error: 'Name required' });
        var slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

        var { data: cat, error } = await sb.from('blog_categories')
          .insert({ name: name, slug: slug, description: body.description || null })
          .select().single();
        if (error) throw error;
        return res.status(201).json({ category: cat });
      }
    }

    // ===== AUDIT LOG =====
    if (action === 'audit_log' && req.method === 'GET') {
      var limit = parseInt(req.query.limit) || 100;
      var { data: logs } = await sb.from('admin_audit_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      return res.status(200).json({ logs: logs || [] });
    }

    return res.status(400).json({ error: 'Unknown action: ' + action });

  } catch (err) {
    console.error('Admin API error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};

async function logAudit(sb, adminId, adminEmail, action, entityType, entityId, details, ip) {
  try {
    await sb.from('admin_audit_log').insert({
      admin_user_id: adminId,
      admin_email: adminEmail,
      action: action,
      entity_type: entityType,
      entity_id: String(entityId),
      details: details || {},
      ip_address: ip || 'unknown'
    });
  } catch (e) { /* non-critical */ }
}
