const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件配置
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));
app.use(express.json());

// 配置信息从环境变量获取
const CONFIG = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_KEY: process.env.SUPABASE_KEY,
  WX_CORP_ID: process.env.WX_CORP_ID,
  WX_SECRET: process.env.WX_SECRET,
  WX_SPACE_ID: process.env.WX_SPACE_ID,
  PROXY_HOST: process.env.PROXY_HOST,
  AVATAR_URL: process.env.AVATAR_URL || 'https://q1.qlogo.cn/g?b=qq&nk=64072478&s=640',
  FRONTEND_URL: process.env.FRONTEND_URL,
  SSO_API_URL: process.env.SSO_API_URL
};

// 验证环境变量
const requiredEnvVars = [
  'SUPABASE_URL', 'SUPABASE_KEY', 'WX_CORP_ID',
  'WX_SECRET', 'WX_SPACE_ID'
];

requiredEnvVars.forEach(envVar => {
  if (!process.env[envVar]) {
    console.error(`错误: 缺少必需的环境变量 ${envVar}`);
    process.exit(1);
  }
});

// HTML转义函数
function escapeHtml(unsafe) {
  if (typeof unsafe !== 'string') return unsafe;
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/\//g, "&#x2F;");
}

// 获取微信企业API access_token
async function getAccessToken() {
  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${CONFIG.WX_CORP_ID}&corpsecret=${CONFIG.WX_SECRET}`;
  const response = await fetch(url);
  const data = await response.json();
  
  if (data.errcode === 0) {
    return data.access_token;
  } else {
    throw new Error(`获取access_token失败: ${data.errmsg}`);
  }
}

// 验证用户登录状态
async function verifyUser(authHeader) {
  if (!authHeader) return { logged_in: false, user: null };
  
  const token = authHeader.replace('Bearer ', '');
  
  if (!token) {
    return { logged_in: false, user: null };
  }
  
  try {
    // 检查会话
    const sessionResponse = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/sessions?token=eq.${token}&select=user_id`,
      {
        headers: {
          'apikey': CONFIG.SUPABASE_KEY,
          'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`
        }
      }
    );
    
    if (!sessionResponse.ok) {
      return { logged_in: false, user: null };
    }
    
    const sessions = await sessionResponse.json();
    if (!sessions || sessions.length === 0) {
      return { logged_in: false, user: null };
    }
    
    const userId = sessions[0].user_id;
    
    // 获取用户信息
    const userResponse = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=username,avatar,is_admin`,
      {
        headers: {
          'apikey': CONFIG.SUPABASE_KEY,
          'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`
        }
      }
    );
    
    if (!userResponse.ok) {
      return { logged_in: false, user: null };
    }
    
    const users = await userResponse.json();
    if (!users || users.length === 0) {
      return { logged_in: false, user: null };
    }
    
    const user = users[0];
    return {
      logged_in: true,
      user: {
        id: userId,
        username: user.username || '秋名山香蕉',
        avatar: user.avatar || CONFIG.AVATAR_URL,
        is_admin: user.is_admin || false
      }
    };
  } catch (error) {
    console.error('验证用户失败:', error);
    return { logged_in: false, user: null };
  }
}

// 替换下载URL的主机部分为代理域名
function replaceDownloadHost(originalUrl) {
  try {
    const url = new URL(originalUrl);
    url.host = CONFIG.PROXY_HOST;
    url.protocol = 'https:';
    return url.toString();
  } catch (error) {
    console.error('替换下载URL失败:', error);
    return originalUrl;
  }
}

// 1. 获取单个帖子详情
app.get('/api/posts/:id', async (req, res) => {
  const postId = req.params.id;
  
  if (!postId || isNaN(postId)) {
    return res.status(400).json({ error: '无效的帖子ID' });
  }
  
  try {
    // 获取帖子信息
    const postResponse = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/posts?id=eq.${postId}&select=*,users(username,avatar),view_count`,
      {
        headers: {
          'apikey': CONFIG.SUPABASE_KEY,
          'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`
        }
      }
    );
    
    if (!postResponse.ok) {
      throw new Error('获取帖子失败');
    }
    
    const posts = await postResponse.json();
    if (!posts || posts.length === 0) {
      return res.status(404).json({ error: '帖子不存在' });
    }
    
    const post = posts[0];
    
    // 异步更新浏览量
    setTimeout(async () => {
      try {
        const currentViewCount = post.view_count || 0;
        await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/posts?id=eq.${postId}`, {
          method: 'PATCH',
          headers: {
            'apikey': CONFIG.SUPABASE_KEY,
            'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            view_count: currentViewCount + 1
          })
        });
      } catch (error) {
        console.error('更新浏览量失败:', error);
      }
    }, 0);
    
    // 获取评论
    const commentsResponse = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/comments?post_id=eq.${postId}&select=*,users(username,avatar)&order=created_at.asc`,
      {
        headers: {
          'apikey': CONFIG.SUPABASE_KEY,
          'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`
        }
      }
    );
    
    let comments = [];
    if (commentsResponse.ok) {
      const rawComments = await commentsResponse.json();
      
      comments = await Promise.all(rawComments.map(async comment => {
        let parentUsername = null;
        
        if (comment.parent_id && comment.parent_id > 0) {
          const parentCommentResponse = await fetch(
            `${CONFIG.SUPABASE_URL}/rest/v1/comments?id=eq.${comment.parent_id}&select=user_id`,
            {
              headers: {
                'apikey': CONFIG.SUPABASE_KEY,
                'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`
              }
            }
          );
          
          if (parentCommentResponse.ok) {
            const parentComments = await parentCommentResponse.json();
            if (parentComments.length > 0) {
              const parentUserId = parentComments[0].user_id;
              const parentUserResponse = await fetch(
                `${CONFIG.SUPABASE_URL}/rest/v1/users?id=eq.${parentUserId}&select=username`,
                {
                  headers: {
                    'apikey': CONFIG.SUPABASE_KEY,
                    'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`
                  }
                }
              );
              
              if (parentUserResponse.ok) {
                const parentUsers = await parentUserResponse.json();
                parentUsername = parentUsers[0]?.username || null;
              }
            }
          }
        }
        
        return {
          id: comment.id,
          post_id: comment.post_id,
          parent_id: comment.parent_id || 0,
          user_id: comment.user_id || 1,
          content: comment.content,
          created_at: comment.created_at,
          username: comment.users?.username || '秋名山香蕉',
          avatar: CONFIG.AVATAR_URL,
          parent_username: parentUsername
        };
      }));
    }
    
    // 构建响应
    const result = {
      post: {
        id: post.id,
        title: post.title,
        content: post.content,
        excerpt: post.excerpt || null,
        author_id: 1,
        view_count: post.view_count || 0,
        comment_count: post.comment_count || 0,
        category: post.category || null,
        tags: post.tags || null,
        created_at: post.created_at,
        updated_at: post.updated_at || post.created_at,
        username: '秋名山香蕉',
        avatar: CONFIG.AVATAR_URL
      },
      comments: comments
    };
    
    res.json(result);
    
  } catch (error) {
    console.error('获取帖子详情失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// 2. 获取用户状态
app.get('/api/user/status', async (req, res) => {
  try {
    const auth = await verifyUser(req.headers.authorization);
    
    res.json({
      logged_in: auth.logged_in,
      user: auth.user
    });
    
  } catch (error) {
    console.error('获取用户状态失败:', error);
    res.json({ logged_in: false });
  }
});

// 3. 用户登出
app.post('/api/user/logout', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: '未授权' });
    }
    
    // 删除会话
    await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/sessions?token=eq.${token}`, {
      method: 'DELETE',
      headers: {
        'apikey': CONFIG.SUPABASE_KEY,
        'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`
      }
    });
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('用户登出失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// 4. 获取追番列表
app.get('/api/anime', async (req, res) => {
  try {
    // 永远返回用户ID为1（秋名山香蕉）的追番列表
    const response = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/anime_list?user_id=eq.1&order=created_at.desc`,
      {
        headers: {
          'apikey': CONFIG.SUPABASE_KEY,
          'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`
        }
      }
    );
    
    if (!response.ok) {
      throw new Error('获取追番列表失败');
    }
    
    const animeList = await response.json();
    
    const processedList = animeList.map(anime => ({
      id: anime.id,
      user_id: 1,
      title: anime.title,
      cover_url: anime.cover_url,
      status: anime.status || 'watching',
      created_at: anime.created_at,
      completed_date: anime.completed_date
    }));
    
    res.json(processedList);
    
  } catch (error) {
    console.error('获取追番列表失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// 5. 搜索帖子
app.get('/api/search-posts', async (req, res) => {
  try {
    // 查询帖子数据
    const response = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/posts?select=id,title,content,tags&order=created_at.desc`,
      {
        headers: {
          'apikey': CONFIG.SUPABASE_KEY,
          'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`
        }
      }
    );
    
    if (!response.ok) {
      throw new Error('获取帖子失败');
    }
    
    const posts = await response.json();
    
    // 处理数据格式
    const processedPosts = posts.map(post => ({
      id: post.id,
      title: post.title || '无标题',
      content: post.content || '',
      tags: post.tags || ''
    }));
    
    res.json(processedPosts);
    
  } catch (error) {
    console.error('搜索帖子失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// 6. SSO验证
app.post('/api/sso/verify', async (req, res) => {
  try {
    const { au: auToken, random_string: randomString } = req.body;
    
    if (!auToken || !randomString) {
      return res.status(400).json({ error: '缺少必要参数' });
    }
    
    // 1. 查找验证会话
    const sessionResponse = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/auth_sessions?au_token=eq.${auToken}&select=encrypted_msg,user_data`,
      {
        headers: {
          'apikey': CONFIG.SUPABASE_KEY,
          'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`
        }
      }
    );
    
    if (!sessionResponse.ok) {
      throw new Error('查询验证会话失败');
    }
    
    const sessions = await sessionResponse.json();
    if (!sessions || sessions.length === 0) {
      return res.status(400).json({ error: '验证会话已过期' });
    }
    
    const { encrypted_msg, user_data } = sessions[0];
    
    // 2. SHA256加密验证
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(randomString);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const calculatedEncrypted = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    if (calculatedEncrypted !== encrypted_msg) {
      return res.status(400).json({ error: '验证失败' });
    }
    
    const userData = user_data;
    const username = userData.username || '未知用户';
    const ssoId = String(userData.id);
    const email = userData.email || '';
    
    // 3. 查找或创建用户
    const userResponse = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/users?sso_id=eq.${ssoId}&select=id,username`,
      {
        headers: {
          'apikey': CONFIG.SUPABASE_KEY,
          'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`
        }
      }
    );
    
    let user;
    let userId;
    
    if (userResponse.ok) {
      const users = await userResponse.json();
      if (users && users.length > 0) {
        user = users[0];
        userId = user.id;
        
        // 更新用户名
        await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/users?id=eq.${userId}`, {
          method: 'PATCH',
          headers: {
            'apikey': CONFIG.SUPABASE_KEY,
            'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            username: username,
            email: email
          })
        });
      }
    }
    
    // 创建新用户
    if (!userId) {
      const createUserResponse = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/users`, {
        method: 'POST',
        headers: {
          'apikey': CONFIG.SUPABASE_KEY,
          'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({
          username: username,
          sso_id: ssoId,
          email: email,
          avatar: CONFIG.AVATAR_URL
        })
      });
      
      if (!createUserResponse.ok) {
        throw new Error('创建用户失败');
      }
      
      const newUsers = await createUserResponse.json();
      user = newUsers[0];
      userId = user.id;
    }
    
    // 4. 创建登录会话
    const sessionToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const sessionId = crypto.randomUUID();
    
    // 删除旧会话
    await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/sessions?user_id=eq.${userId}`, {
      method: 'DELETE',
      headers: {
        'apikey': CONFIG.SUPABASE_KEY,
        'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`
      }
    });
    
    // 创建新会话
    await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/sessions`, {
      method: 'POST',
      headers: {
        'apikey': CONFIG.SUPABASE_KEY,
        'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        id: sessionId,
        user_id: userId,
        token: sessionToken,
        expires_at: expiresAt
      })
    });
    
    // 5. 清理验证会话
    await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/auth_sessions?au_token=eq.${auToken}`, {
      method: 'DELETE',
      headers: {
        'apikey': CONFIG.SUPABASE_KEY,
        'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`
      }
    });
    
    // 获取最终用户名
    const finalUserResponse = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=username`,
      {
        headers: {
          'apikey': CONFIG.SUPABASE_KEY,
          'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`
        }
      }
    );
    
    const finalUsers = await finalUserResponse.json();
    const finalUsername = finalUsers[0]?.username || username;
    
    res.json({
      success: true,
      token: sessionToken,
      user: {
        id: userId,
        username: finalUsername,
        avatar: CONFIG.AVATAR_URL
      }
    });
    
  } catch (error) {
    console.error('SSO验证失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// 7. 获取帖子列表
app.get('/api/posts', async (req, res) => {
  try {
    // 查询帖子，关联用户信息
    const response = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/posts?select=*,users(username,avatar)&order=created_at.desc`,
      {
        headers: {
          'apikey': CONFIG.SUPABASE_KEY,
          'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`
        }
      }
    );
    
    if (!response.ok) {
      throw new Error('获取帖子失败');
    }
    
    const posts = await response.json();
    
    // 处理数据格式
    const processedPosts = posts.map(post => {
      const content = post.content || '';
      const excerpt = post.excerpt || (content.length > 25 ? content.substring(0, 25) + '...' : content);
      
      return {
        id: post.id,
        title: post.title || '无标题',
        content: content.substring(0, 250) + '...',
        excerpt: excerpt,
        author_id: 1,
        view_count: post.view_count || 0,
        comment_count: post.comment_count || 0,
        category: post.category || null,
        tags: post.tags || null,
        created_at: post.created_at,
        updated_at: post.updated_at || post.created_at,
        username: post.users?.username || '秋名山香蕉',
        avatar: CONFIG.AVATAR_URL
      };
    });
    
    res.json(processedPosts);
    
  } catch (error) {
    console.error('获取帖子列表失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// 8. 文件列表
app.post('/api/list', async (req, res) => {
  try {
    const auth = await verifyUser(req.headers.authorization);
    if (!auth.logged_in) {
      return res.status(401).json({ 
        error: '未登录',
        logged_in: false 
      });
    }
    
    const { fatherid = CONFIG.WX_SPACE_ID, sort_type = 1, start = 0, limit = 100 } = req.body;
    
    // 获取access_token
    const accessToken = await getAccessToken();
    
    // 调用微信API获取文件列表
    const wxResponse = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/wedrive/file_list?access_token=${accessToken}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          spaceid: CONFIG.WX_SPACE_ID,
          fatherid,
          sort_type,
          start,
          limit
        })
      }
    );
    
    const wxData = await wxResponse.json();
    
    res.json({
      ...wxData,
      user: auth.user,
      logged_in: true
    });
    
  } catch (error) {
    console.error('获取文件列表失败:', error);
    res.status(500).json({ 
      error: error.message,
      logged_in: false 
    });
  }
});

// 9. 下载文件
app.post('/api/download', async (req, res) => {
  try {
    const auth = await verifyUser(req.headers.authorization);
    if (!auth.logged_in) {
      return res.status(401).json({ 
        error: '未登录',
        logged_in: false 
      });
    }
    
    const { fileid } = req.body;
    
    if (!fileid) {
      return res.status(400).json({ 
        error: '缺少fileid参数'
      });
    }
    
    // 获取access_token
    const accessToken = await getAccessToken();
    
    // 调用微信API获取下载URL
    const wxResponse = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/wedrive/file_download?access_token=${accessToken}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fileid })
      }
    );
    
    const wxData = await wxResponse.json();
    
    // 如果成功获取下载URL，替换主机为代理域名
    if (wxData.errcode === 0 && wxData.download_url) {
      wxData.download_url = replaceDownloadHost(wxData.download_url);
    }
    
    res.json({
      ...wxData,
      user: auth.user,
      logged_in: true
    });
    
  } catch (error) {
    console.error('下载文件失败:', error);
    res.status(500).json({ 
      error: error.message,
      logged_in: false 
    });
  }
});

// 10. 获取用户信息
app.get('/api/user', async (req, res) => {
  try {
    const auth = await verifyUser(req.headers.authorization);
    res.json(auth);
  } catch (error) {
    console.error('获取用户信息失败:', error);
    res.json({ 
      logged_in: false,
      error: error.message
    });
  }
});

// 11. 添加评论
app.post('/api/posts/:postId/comments', async (req, res) => {
  try {
    const postId = req.params.postId;
    
    // 验证帖子ID
    if (!postId || isNaN(postId)) {
      return res.status(400).json({ error: '无效的帖子ID' });
    }
    
    // 验证登录状态
    const auth = await verifyUser(req.headers.authorization);
    if (!auth.logged_in) {
      return res.status(401).json({ error: '未授权' });
    }
    
    // 获取请求数据
    let { content, parent_id: parentId } = req.body;
    
    // 处理parent_id
    if (parentId === null || parentId === undefined) {
      parentId = 0;
    }
    
    // 验证内容
    if (!content || content.trim() === '') {
      return res.status(400).json({ error: '评论内容不能为空' });
    }
    
    // 检测字符数限制
    if (content.length > 800) {
      return res.status(400).json({ error: '评论内容不能超过800个字符' });
    }
    
    // 对内容进行HTML转义
    content = escapeHtml(content.trim());
    
    // 检查帖子是否存在
    const postResponse = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/posts?id=eq.${postId}`,
      {
        headers: {
          'apikey': CONFIG.SUPABASE_KEY,
          'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`
        }
      }
    );
    
    if (!postResponse.ok) {
      throw new Error('检查帖子失败');
    }
    
    const posts = await postResponse.json();
    if (!posts || posts.length === 0) {
      return res.status(404).json({ error: '帖子不存在' });
    }
    
    // 如果parentId不是0，检查父评论是否存在且属于同一帖子
    if (parentId !== 0) {
      const parentResponse = await fetch(
        `${CONFIG.SUPABASE_URL}/rest/v1/comments?id=eq.${parentId}&post_id=eq.${postId}`,
        {
          headers: {
            'apikey': CONFIG.SUPABASE_KEY,
            'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`
          }
        }
      );
      
      if (!parentResponse.ok) {
        throw new Error('检查父评论失败');
      }
      
      const parentComments = await parentResponse.json();
      if (!parentComments || parentComments.length === 0) {
        return res.status(400).json({ error: '父评论不存在或不属于该帖子' });
      }
    }
    
    // 添加评论
    const commentResponse = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/comments`, {
      method: 'POST',
      headers: {
        'apikey': CONFIG.SUPABASE_KEY,
        'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        post_id: parseInt(postId),
        parent_id: parentId,
        user_id: auth.user.id,
        content: content
      })
    });
    
    if (!commentResponse.ok) {
      const errorText = await commentResponse.text();
      throw new Error(`添加评论失败: ${commentResponse.status} ${errorText}`);
    }
    
    const newComments = await commentResponse.json();
    const newComment = newComments[0];
    
    // 获取当前评论数并更新
    const countResponse = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/posts?id=eq.${postId}&select=comment_count`,
      {
        headers: {
          'apikey': CONFIG.SUPABASE_KEY,
          'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`
        }
      }
    );
    
    let currentCommentCount = 0;
    if (countResponse.ok) {
      const postCounts = await countResponse.json();
      if (postCounts && postCounts.length > 0 && postCounts[0].comment_count !== null) {
        currentCommentCount = postCounts[0].comment_count;
      }
    }
    
    // 更新帖子评论数
    await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/posts?id=eq.${postId}`, {
      method: 'PATCH',
      headers: {
        'apikey': CONFIG.SUPABASE_KEY,
        'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        comment_count: currentCommentCount + 1
      })
    });
    
    res.json({
      success: true,
      comment: {
        id: newComment.id,
        post_id: newComment.post_id,
        parent_id: newComment.parent_id || 0,
        user_id: auth.user.id,
        content: newComment.content,
        created_at: newComment.created_at,
        username: auth.user.username,
        avatar: auth.user.avatar,
        is_admin: auth.user.is_admin
      }
    });
    
  } catch (error) {
    console.error('添加评论失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// 12. 删除评论
app.delete('/api/posts/:postId/comments/:commentId', async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    
    // 验证参数
    if (!postId || isNaN(postId) || !commentId || isNaN(commentId)) {
      return res.status(400).json({ error: '无效的帖子ID或评论ID' });
    }
    
    // 验证登录状态
    const auth = await verifyUser(req.headers.authorization);
    if (!auth.logged_in) {
      return res.status(401).json({ error: '未授权' });
    }
    
    // 获取要删除的评论信息
    const commentResponse = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/comments?id=eq.${commentId}&post_id=eq.${postId}&select=user_id`,
      {
        headers: {
          'apikey': CONFIG.SUPABASE_KEY,
          'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`
        }
      }
    );
    
    if (!commentResponse.ok) {
      throw new Error('获取评论信息失败');
    }
    
    const comments = await commentResponse.json();
    if (!comments || comments.length === 0) {
      return res.status(404).json({ error: '评论不存在或不属于该帖子' });
    }
    
    const comment = comments[0];
    
    // 检查权限：评论所有者或管理员可以删除
    if (comment.user_id !== auth.user.id && !auth.user.is_admin) {
      return res.status(403).json({ error: '无权删除此评论' });
    }
    
    // 递归获取所有要删除的评论ID（包括子评论）
    async function getAllChildCommentIds(startId) {
      const allIds = new Set([startId]);
      let currentLevel = [startId];
      let hasMore = true;
      
      while (hasMore && currentLevel.length > 0) {
        const idsString = currentLevel.join(',');
        const response = await fetch(
          `${CONFIG.SUPABASE_URL}/rest/v1/comments?parent_id=in.(${idsString})&select=id`,
          {
            headers: {
              'apikey': CONFIG.SUPABASE_KEY,
              'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`
            }
          }
        );
        
        if (!response.ok) {
          throw new Error('获取子评论失败');
        }
        
        const childComments = await response.json();
        const childIds = childComments.map(c => c.id);
        
        if (childIds.length === 0) {
          hasMore = false;
        } else {
          childIds.forEach(id => allIds.add(id));
          currentLevel = childIds;
        }
      }
      
      return Array.from(allIds);
    }
    
    // 获取所有要删除的评论ID
    const allCommentIds = await getAllChildCommentIds(commentId);
    const deleteCount = allCommentIds.length;
    
    // 批量删除所有评论
    let deletedSuccessCount = 0;
    for (const id of allCommentIds) {
      const deleteResponse = await fetch(
        `${CONFIG.SUPABASE_URL}/rest/v1/comments?id=eq.${id}&post_id=eq.${postId}`,
        {
          method: 'DELETE',
          headers: {
            'apikey': CONFIG.SUPABASE_KEY,
            'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      if (deleteResponse.ok) {
        deletedSuccessCount++;
      } else {
        console.warn(`删除评论 ${id} 失败，但继续尝试删除其他评论`);
      }
    }
    
    // 获取当前评论数并更新
    const countResponse = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/posts?id=eq.${postId}&select=comment_count`,
      {
        headers: {
          'apikey': CONFIG.SUPABASE_KEY,
          'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`
        }
      }
    );
    
    let currentCommentCount = 0;
    if (countResponse.ok) {
      const postCounts = await countResponse.json();
      if (postCounts && postCounts.length > 0 && postCounts[0].comment_count !== null) {
        currentCommentCount = postCounts[0].comment_count;
      }
    }
    
    const newCommentCount = Math.max(0, currentCommentCount - deletedSuccessCount);
    
    await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/posts?id=eq.${postId}`, {
      method: 'PATCH',
      headers: {
        'apikey': CONFIG.SUPABASE_KEY,
        'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        comment_count: newCommentCount
      })
    });
    
    res.json({ 
      success: true,
      message: '评论删除成功',
      deleted_count: deletedSuccessCount
    });
    
  } catch (error) {
    console.error('删除评论失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// 13. SSO回调处理
app.get('/api/sso/callback', async (req, res) => {
  try {
    const { code } = req.query;
    
    if (!code) {
      return res.status(400).json({ error: '缺少code参数' });
    }
    
    // 调用SSO API验证code
    const ssoResponse = await fetch(`${CONFIG.SSO_API_URL}${code}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    
    if (!ssoResponse.ok) {
      let errorMessage;
      
      // 尝试获取详细错误信息
      try {
        const contentType = ssoResponse.headers.get('content-type') || '';
        
        if (contentType.includes('application/json')) {
          const errorData = await ssoResponse.json();
          errorMessage = errorData.message || errorData.error || JSON.stringify(errorData);
        } else {
          errorMessage = await ssoResponse.text();
        }
      } catch (error) {
        errorMessage = ssoResponse.statusText || '未知错误';
      }
      
      return res.status(ssoResponse.status || 400).json({ 
        error: `SSO验证失败: ${errorMessage}`,
        status: ssoResponse.status
      });
    }
    
    const userData = await ssoResponse.json();
    const encryptedMsg = userData.msg;
    
    if (!encryptedMsg) {
      return res.status(400).json({ error: '缺少msg字段' });
    }
    
    // 生成au_token
    const auToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    
    // 保存验证会话到Supabase
    const saveResponse = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/auth_sessions`, {
      method: 'POST',
      headers: {
        'apikey': CONFIG.SUPABASE_KEY,
        'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        au_token: auToken,
        encrypted_msg: encryptedMsg,
        user_data: userData,
        expires_at: expiresAt
      })
    });
    
    if (!saveResponse.ok) {
      throw new Error('保存验证会话失败');
    }
    
    // 重定向到前端
    res.redirect(302, `${CONFIG.FRONTEND_URL}/?au=${auToken}`);
    
  } catch (error) {
    console.error('SSO回调处理失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// 健康检查端点
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 处理未匹配的路由
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Frontend URL: ${CONFIG.FRONTEND_URL || 'Not set'}`);
});