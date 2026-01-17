document.addEventListener('DOMContentLoaded', updateCopyrightTime);
let currentUser = null;
let searchPostsCache = null;
let authToken = localStorage.getItem('auth_token');
// 改为创建自定义渲染器对象
// 创建自定义扩展来处理特殊格式
const customExtension = {
  name: 'customTags',
  level: 'inline',
  tokenizer(src) {
    // 处理 ![github](username/repo)
    const githubRule = /^!\[github\]\(([\w-]+\/[\w.-]+)\)/;
    const githubMatch = githubRule.exec(src);
    if (githubMatch) {
      return {
        type: 'githubRepo',
        raw: githubMatch[0],
        repo: githubMatch[1]
      };
    }
    
    // 处理 ![file](name,type,fileid)
    const fileRule = /^!\[file\]\(([^,]+),([^,]+),([^)]+)\)/;
    const fileMatch = fileRule.exec(src);
    if (fileMatch) {
      return {
        type: 'fileDownload',
        raw: fileMatch[0],
        name: fileMatch[1],
        fileType: fileMatch[2],
        fileId: fileMatch[3]
      };
    }
    
    return false;
  },
  renderer(token) {
    if (token.type === 'githubRepo') {
      return `<!-- GITHUB_REPO_START:${token.repo} -->`;
    }
    if (token.type === 'fileDownload') {
      return `<!-- FILE_DOWNLOAD_START:${token.name}|${token.fileType}|${token.fileId} -->`;
    }
  }
};

// 使用扩展
marked.use({ extensions: [customExtension] });

// 设置其他选项
marked.setOptions({
  breaks: true,
  gfm: true,
  highlight: function(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(lang, code).value;
      } catch (err) {
        console.error('高亮代码失败:', err);
      }
    }
    return code;
  }
});

// GitHub仓库信息缓存
const githubRepoCache = new Map();

// 处理Markdown中的自定义标签
async function processCustomTags(html) {
    // 首先处理GitHub仓库引用
    let processedHtml = await processGithubRepos(html);
    
    // 然后处理文件下载
    processedHtml = processFileDownloads(processedHtml);
    
    return processedHtml;
}

// 处理GitHub仓库引用
async function processGithubRepos(html) {
    const githubRepoRegex = /<!-- GITHUB_REPO_START:([\w-]+\/[\w.-]+) -->/g;
    const matches = [...html.matchAll(githubRepoRegex)];
    
    if (matches.length === 0) return html;
    
    // 收集所有需要处理的仓库
    const reposToProcess = matches.map(match => match[1]);
    
    // 并行获取所有仓库信息
    const repoPromises = reposToProcess.map(async repoPath => {
        if (githubRepoCache.has(repoPath)) {
            return { repoPath, data: githubRepoCache.get(repoPath) };
        }
        
        try {
            const data = await fetchGithubRepoInfo(repoPath);
            githubRepoCache.set(repoPath, data);
            return { repoPath, data };
        } catch (error) {
            console.error(`获取GitHub仓库信息失败 (${repoPath}):`, error);
            return { 
                repoPath, 
                data: {
                    error: true,
                    full_name: repoPath,
                    description: '无法加载仓库信息',
                    visibility: 'Unknown',
                    language: null,
                    stargazers_count: 0,
                    forks_count: 0,
                    updated_at: new Date().toISOString()
                }
            };
        }
    });
    
    const repoResults = await Promise.all(repoPromises);
    
    // 创建映射以便快速查找
    const repoMap = new Map();
    repoResults.forEach(result => {
        repoMap.set(result.repoPath, result.data);
    });
    
    // 替换所有仓库引用
    return html.replace(githubRepoRegex, (match, repoPath) => {
        const repoData = repoMap.get(repoPath);
        return generateGithubRepoHTML(repoData, repoPath);
    });
}

// 获取GitHub仓库信息
async function fetchGithubRepoInfo(repoPath) {
    // 使用GitHub API获取仓库信息
    const apiUrl = `https://api.github.com/repos/${repoPath}`;
    
    try {
        const response = await fetch(apiUrl, {
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'Your-Blog-App'
            }
        });
        
        if (!response.ok) {
            throw new Error(`GitHub API响应异常: ${response.status}`);
        }
        
        const data = await response.json();
        
        return {
            full_name: data.full_name,
            description: data.description || '暂无描述',
            visibility: data.private ? 'Private' : 'Public',
            language: data.language,
            stargazers_count: data.stargazers_count,
            forks_count: data.forks_count,
            updated_at: data.updated_at,
            html_url: data.html_url,
            error: false
        };
    } catch (error) {
        console.error('获取GitHub仓库信息失败:', error);
        throw error;
    }
}

// 生成GitHub仓库HTML
function generateGithubRepoHTML(repoData, repoPath) {
    if (repoData.error) {
        return `
        <div class="github-ref-box error">
            <div class="repo-header">
                <div class="repo-title">
                    <i class="fab fa-github repo-icon"></i>
                    <span class="repo-name">${escapeHtml(repoPath)}</span>
                </div>
                <span class="repo-visibility">Error</span>
            </div>
            <p class="repo-description">
                无法加载仓库信息，请检查仓库路径或稍后重试。
            </p>
        </div>
        `;
    }
    
    // 格式化数字
    const formatNumber = (num) => {
        if (num >= 1000) {
            return (num / 1000).toFixed(1) + 'k';
        }
        return num.toString();
    };
    
    // 格式化更新时间
    const formatUpdateTime = (dateString) => {
        const date = new Date(dateString);
        const now = new Date();
        const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
        
        if (diffDays === 0) return 'Updated today';
        if (diffDays === 1) return 'Updated yesterday';
        if (diffDays < 7) return `Updated ${diffDays} days ago`;
        if (diffDays < 30) return `Updated ${Math.floor(diffDays / 7)} weeks ago`;
        if (diffDays < 365) return `Updated ${Math.floor(diffDays / 30)} months ago`;
        return `Updated ${Math.floor(diffDays / 365)} years ago`;
    };
    
    // 语言颜色映射
    const languageColors = {
        'JavaScript': '#f1e05a',
        'TypeScript': '#3178c6',
        'Python': '#3572A5',
        'Java': '#b07219',
        'C++': '#f34b7d',
        'C#': '#178600',
        'Go': '#00ADD8',
        'Rust': '#dea584',
        'Ruby': '#701516',
        'PHP': '#4F5D95',
        'Swift': '#ffac45',
        'Kotlin': '#A97BFF',
        'HTML': '#e34c26',
        'CSS': '#563d7c',
        'Vue': '#41b883',
        'React': '#61dafb',
        'Dart': '#00B4AB',
        'Shell': '#89e051'
    };
    
    const languageColor = languageColors[repoData.language] || '#586069';
    
    return `
    <div class="github-ref-box">
        <div class="repo-header">
            <div class="repo-title">
                <i class="fab fa-github repo-icon"></i>
                <a href="${repoData.html_url}" class="repo-name" target="_blank" rel="noopener noreferrer">
                    ${escapeHtml(repoData.full_name)}
                </a>
            </div>
            <span class="repo-visibility">${repoData.visibility}</span>
        </div>
        <p class="repo-description">
            ${escapeHtml(repoData.description)}
        </p>
        <div class="repo-meta">
            ${repoData.language ? `
            <div class="repo-language">
                <span class="language-color" style="background-color: ${languageColor}"></span>
                <span>${escapeHtml(repoData.language)}</span>
            </div>
            ` : ''}
            <div class="stars">
                <i class="far fa-star meta-icon"></i>
                <span>${formatNumber(repoData.stargazers_count)} stars</span>
            </div>
            <div class="forks">
                <i class="fas fa-code-branch meta-icon"></i>
                <span>${formatNumber(repoData.forks_count)} forks</span>
            </div>
            <div class="updated">
                <i class="far fa-clock meta-icon"></i>
                <span>${formatUpdateTime(repoData.updated_at)}</span>
            </div>
        </div>
    </div>
    `;
}

// 处理文件下载标签
function processFileDownloads(html) {
    const fileDownloadRegex = /<!-- FILE_DOWNLOAD_START:([^|]+)\|([^|]+)\|([^|]+) -->/g;
    
    return html.replace(fileDownloadRegex, (match, name, type, fileid) => {
        return generateFileDownloadHTML(name, type, fileid);
    });
}

// 生成文件下载HTML
function generateFileDownloadHTML(name, type, fileid) {
    const fileIcon = getFileIcon(type);
    
    return `
    <div class="file-download-box" data-fileid="${escapeHtml(fileid)}">
        <div class="file-header">
            <i class="${fileIcon} file-icon"></i>
            <div class="file-info">
                <span class="file-name">${escapeHtml(name)}</span>
                <span class="file-type">${escapeHtml(type)}</span>
            </div>
        </div>
        <button class="download-btn" onclick="downloadFile('${escapeHtml(fileid)}', '${escapeHtml(name)}')">
            <i class="fas fa-download"></i> 下载
        </button>
    </div>
    `;
}

// 获取文件图标
function getFileIcon(fileType) {
    const iconMap = {
        'pdf': 'fas fa-file-pdf',
        'doc': 'fas fa-file-word',
        'docx': 'fas fa-file-word',
        'xls': 'fas fa-file-excel',
        'xlsx': 'fas fa-file-excel',
        'ppt': 'fas fa-file-powerpoint',
        'pptx': 'fas fa-file-powerpoint',
        'zip': 'fas fa-file-archive',
        'rar': 'fas fa-file-archive',
        '7z': 'fas fa-file-archive',
        'txt': 'fas fa-file-alt',
        'md': 'fas fa-file-alt',
        'json': 'fas fa-file-code',
        'xml': 'fas fa-file-code',
        'html': 'fas fa-file-code',
        'css': 'fas fa-file-code',
        'js': 'fas fa-file-code',
        'py': 'fas fa-file-code',
        'java': 'fas fa-file-code',
        'c': 'fas fa-file-code',
        'cpp': 'fas fa-file-code',
        'jpg': 'fas fa-file-image',
        'jpeg': 'fas fa-file-image',
        'png': 'fas fa-file-image',
        'gif': 'fas fa-file-image',
        'mp3': 'fas fa-file-audio',
        'mp4': 'fas fa-file-video',
        'avi': 'fas fa-file-video',
        'mov': 'fas fa-file-video'
    };
    
    const extension = fileType.toLowerCase();
    return iconMap[extension] || 'fas fa-file';
}

// 下载文件函数
async function downloadFile(fileid, filename) {
    if (!authToken) {
        alert('请先登录才能下载文件');
        ssoLogin();
        return;
    }
    
    const downloadBtn = event.target.closest('.download-btn');
    const originalText = downloadBtn.innerHTML;
    
    try {
        // 显示加载状态
        downloadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 准备中...';
        downloadBtn.disabled = true;
        
        // 请求下载链接
        const response = await fetch('https://blog.kish.top/api/download', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                fileid: fileid
            })
        });
        
        if (!response.ok) {
            throw new Error('下载请求失败');
        }
        
        const data = await response.json();
        
        if (!data.download_url) {
            throw new Error('未获取到下载链接');
        }
        
        // 构建最终下载URL
        const finalUrl = data.download_url + 
            (data.download_url.includes('?') ? '&' : '?') + 
            `authkey=${encodeURIComponent(data.cookie_value)}`;
        
        // 创建隐藏的下载链接
        const a = document.createElement('a');
        a.href = finalUrl;
        a.download = filename || 'download';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        // 显示成功状态
        downloadBtn.innerHTML = '<i class="fas fa-check"></i> 已开始下载';
        downloadBtn.style.backgroundColor = '#28a745';
        
        // 3秒后恢复原状
        setTimeout(() => {
            downloadBtn.innerHTML = originalText;
            downloadBtn.style.backgroundColor = '';
            downloadBtn.disabled = false;
        }, 3000);
        
    } catch (error) {
        console.error('下载文件失败:', error);
        
        downloadBtn.innerHTML = '<i class="fas fa-times"></i> 下载失败';
        downloadBtn.style.backgroundColor = '#dc3545';
        
        setTimeout(() => {
            downloadBtn.innerHTML = originalText;
            downloadBtn.style.backgroundColor = '';
            downloadBtn.disabled = false;
        }, 3000);
        
        alert('下载失败: ' + error.message);
    }
}

// 搜索相关变量
let searchTimeout = null;
let searchResults = [];
let currentSearchTerm = '';

function updateCopyrightTime() {
  const currentYear = new Date().getFullYear();
  const copyrightElement = document.getElementById('copyright-time');
  if (copyrightElement) {
    copyrightElement.textContent = `2017-${currentYear}`;
  } else {
    console.warn('未找到id为"copyright-time"的元素');
  }
}

// 追番模态框功能
const animeModal = document.getElementById('animeModal');
let isAnimeModalOpen = false;

// 目录相关变量
let currentToc = null;
let tocContainer = null;
let isWideScreen = window.innerWidth > 1600;

// 下拉菜单管理
let activeDropdown = null;
let dropdowns = {};

document.addEventListener('DOMContentLoaded', loadNotice);
async function loadNotice() {
  try {
    // 1. 请求config.json文件
    const response = await fetch('/config.json');
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    // 2. 解析JSON数据
    const config = await response.json();
    
    // 3. 获取notice容器元素
    const noticeContainer = document.getElementById('notice');
    if (!noticeContainer) {
      console.error('Element with id "notice" not found');
      return;
    }
    
    // 4. 如果存在notice字段，按换行符分割并添加<p>标签
    if (config.notice) {
      const noticeText = config.notice;
      const paragraphs = noticeText
        .split('\n')
        .filter(line => line.trim() !== '')
        .map(line => `<p>${line}</p>`)
        .join('');
      
      noticeContainer.innerHTML = paragraphs;
    }
    
    // 5. 获取sidebar容器
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) {
      console.warn('Element with class "sidebar" not found');
      return;
    }
    
    // 6. 计算高度差
    const viewportHeight = window.innerHeight;
    const sidebarHeight = sidebar.offsetHeight;
    const heightDifference = viewportHeight - sidebarHeight;
    
    // 7. 设置CSS变量
    document.documentElement.style.setProperty('--sideheight', `${heightDifference}px`);
    
    // 8. 可选：添加事件监听器，在窗口大小改变时重新计算
    const handleResize = () => {
      const newViewportHeight = window.innerHeight;
      const newSidebarHeight = sidebar.offsetHeight;
      const newHeightDifference = newViewportHeight - newSidebarHeight;
      document.documentElement.style.setProperty('--sideheight', `${newHeightDifference}px`);
    };
    
    // 移除之前可能添加的事件监听器
    window.removeEventListener('resize', handleResize);
    // 添加新的事件监听器
    window.addEventListener('resize', handleResize);
    
    console.log('CSS变量 --sideheight 已设置为:', heightDifference);
    
  } catch (error) {
    console.error('Error in loadNoticeAndSetSidebarHeight:', error);
    
    // 显示错误信息（可选）
    const noticeContainer = document.getElementById('notice');
    if (noticeContainer) {
      noticeContainer.innerHTML = '<p>无法加载通知内容</p>';
    }
  }
}
// 初始化下拉菜单
function initDropdowns() {
    // 搜索下拉菜单
    const searchDropdown = document.querySelector('.search-dropdown');
    const searchToggle = document.getElementById('searchToggle');
    const searchMenu = document.querySelector('.search-menu');
    
    dropdowns.search = {
        element: searchDropdown,
        toggle: searchToggle,
        menu: searchMenu,
        isOpen: false
    };
    
    // 工具下拉菜单
    const toolsDropdown = document.querySelector('.tools-dropdown');
    const toolsToggle = document.getElementById('toolsToggle');
    const toolsMenu = document.querySelector('.tools-menu');
    
    dropdowns.tools = {
        element: toolsDropdown,
        toggle: toolsToggle,
        menu: toolsMenu,
        isOpen: false
    };
    
    // 为所有下拉菜单绑定事件
    Object.keys(dropdowns).forEach(key => {
        const dropdown = dropdowns[key];
        
        // 点击切换下拉菜单
        dropdown.toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleDropdown(key);
        });
        
        // 鼠标悬停显示下拉菜单
        dropdown.element.addEventListener('mouseenter', () => {
            if (window.innerWidth > 768) { // 只在桌面端启用悬停
                showDropdown(key);
            }
        });
        
        dropdown.element.addEventListener('mouseleave', (e) => {
            if (window.innerWidth > 768 && activeDropdown === key) {
                // 延迟关闭，避免立即关闭
                setTimeout(() => {
                    const isHovering = dropdown.element.matches(':hover') || dropdown.menu.matches(':hover');
                    if (!isHovering) {
                        hideDropdown(key);
                    }
                }, 200);
            }
        });
    });
    
    // 点击其他地方关闭所有下拉菜单
    document.addEventListener('click', (e) => {
        if (activeDropdown) {
            const activeMenu = dropdowns[activeDropdown].menu;
            const activeToggle = dropdowns[activeDropdown].toggle;
            
            if (!activeMenu.contains(e.target) && !activeToggle.contains(e.target)) {
                hideDropdown(activeDropdown);
            }
        }
    });
    
    // ESC键关闭下拉菜单
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && activeDropdown) {
            hideDropdown(activeDropdown);
        }
    });
}

// 显示下拉菜单
function showDropdown(name) {
    if (activeDropdown && activeDropdown !== name) {
        hideDropdown(activeDropdown);
    }
    
    const dropdown = dropdowns[name];
    if (!dropdown) return;
    
    dropdown.isOpen = true;
    dropdown.menu.style.display = 'block';
    dropdown.element.classList.add('active');
    
    // 添加动画
    setTimeout(() => {
        dropdown.menu.classList.add('show');
    }, 10);
    
    activeDropdown = name;
    
    // 如果是搜索下拉菜单，聚焦输入框
    if (name === 'search') {
        setTimeout(() => {
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.focus();
            }
        }, 100);
    }
}

// 隐藏下拉菜单
function hideDropdown(name) {
    const dropdown = dropdowns[name];
    if (!dropdown || !dropdown.isOpen) return;
    
    dropdown.menu.classList.remove('show');
    dropdown.element.classList.remove('active');
    
    setTimeout(() => {
        dropdown.menu.style.display = 'none';
        dropdown.isOpen = false;
        
        if (activeDropdown === name) {
            activeDropdown = null;
        }
    }, 300);
}

// 切换下拉菜单
function toggleDropdown(name) {
    const dropdown = dropdowns[name];
    if (!dropdown) return;
    
    if (dropdown.isOpen) {
        hideDropdown(name);
    } else {
        showDropdown(name);
    }
}

// 搜索文章
function searchPosts(keyword) {
    if (!keyword.trim()) {
        clearSearchResults();
        return;
    }
    
    currentSearchTerm = keyword;
    
    // 如果没有缓存数据，先加载
    if (!searchPostsCache) {
        fetchSearchPosts(keyword);
        return;
    }
    
    // 使用缓存数据进行搜索
    performSearch(keyword, searchPostsCache);
}
// 加载搜索文章数据
async function fetchSearchPosts(keyword = '') {
    try {
        const response = await fetch('/api/search-posts');
        
        if (!response.ok) {
            throw new Error('获取文章列表失败');
        }
        
        const allPosts = await response.json();
        // 缓存数据
        searchPostsCache = allPosts;
        
        // 如果有搜索关键词，执行搜索
        if (keyword.trim()) {
            performSearch(keyword, allPosts);
        }
    } catch (error) {
        console.error('获取文章数据失败:', error);
        const resultsContainer = document.getElementById('searchResults');
        if (resultsContainer) {
            resultsContainer.innerHTML = '<div class="search-result-item error">获取文章数据失败，请稍后重试</div>';
        }
    }
}
// 执行搜索
function performSearch(keyword, posts) {
    // 在客户端进行搜索过滤
    const results = posts.filter(post => {
        // 搜索标题、内容、标签
        const searchInTitle = post.title && post.title.toLowerCase().includes(keyword.toLowerCase());
        const searchInContent = post.content && post.content.toLowerCase().includes(keyword.toLowerCase());
        const searchInTags = post.tags && post.tags.toLowerCase().includes(keyword.toLowerCase());
        
        return searchInTitle || searchInContent || searchInTags;
    });
    
    searchResults = results;
    renderSearchResults(results, keyword);
}
// 渲染搜索结果
function renderSearchResults(results, keyword) {
    const resultsContainer = document.getElementById('searchResults');
    if (!resultsContainer) return;
    
    if (results.length === 0) {
        resultsContainer.innerHTML = '<div class="search-result-item empty">没有找到相关文章</div>';
        return;
    }
    
    // 高亮关键词
    const highlightText = (text) => {
        if (!keyword || !text) return escapeHtml(text || '');
        const regex = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        return escapeHtml(text || '').replace(regex, '<mark>$1</mark>');
    };
    
    const resultsHTML = results.map(post => `
        <div class="search-result-item" onclick="openSearchResult(${post.id})">
            <div class="search-result-title">${highlightText(post.title)}</div>
            <div class="search-result-excerpt">${highlightText(post.content.substring(0, 100))}...</div>
            <div class="search-result-meta">
                <span class="search-result-tags">${post.tags ? highlightText(post.tags) : '无标签'}</span>
            </div>
        </div>
    `).join('');
    
    resultsContainer.innerHTML = resultsHTML;
}

// 清空搜索结果
function clearSearchResults() {
    const resultsContainer = document.getElementById('searchResults');
    if (resultsContainer) {
        resultsContainer.innerHTML = '';
    }
    searchResults = [];
    currentSearchTerm = '';
}

// 打开搜索结果
function openSearchResult(postId) {
    // 隐藏搜索下拉菜单
    hideDropdown('search');
    
    // 清空搜索输入框
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.value = '';
    }
    
    // 清空搜索结果
    clearSearchResults();
    
    // 直接打开文章详情，不进行高亮
    openPostDetail(postId);
}

// 在文章内容中高亮搜索关键词
function highlightSearchKeywords(keyword) {
    if (!keyword) return;
    
    const postContent = document.getElementById('postContent');
    if (!postContent) return;
    
    const regex = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const originalHTML = postContent.innerHTML;
    
    // 避免重复高亮
    if (!originalHTML.includes('<mark>')) {
        const highlightedHTML = originalHTML.replace(regex, '<mark class="search-highlight">$1</mark>');
        postContent.innerHTML = highlightedHTML;
    }
}

// 打开追番模态框
function openAnimeModal() {
    if (!currentUser) {
        alert('请先登录查看追番列表');
        ssoLogin();
        return;
    }
    
    isAnimeModalOpen = true;
    loadAnimeList();
    animeModal.style.display = 'block';
    document.body.style.overflow = 'hidden';
    
    // 添加动画类
    animeModal.classList.remove('hiding');
    animeModal.classList.add('showing');
    
    // 设置卡片动画延迟
    setTimeout(() => {
        const cards = document.querySelectorAll('.anime-modal .anime-card');
        cards.forEach((card, index) => {
            card.style.animationDelay = `${index * 0.1}s`;
        });
    }, 100);
}

// 关闭追番模态框
function closeAnimeModal() {
    animeModal.classList.remove('showing');
    animeModal.classList.add('hiding');
    
    setTimeout(() => {
        animeModal.style.display = 'none';
        document.body.style.overflow = 'auto';
        isAnimeModalOpen = false;
        animeModal.classList.remove('hiding');
    }, 400);
}

// 页面切换动画函数
async function switchPage(fromPage, toPage, direction = 'forward', toPageDisplayType = null) {
    if (fromPage) {
        fromPage.classList.add('hiding');
        await new Promise(resolve => setTimeout(resolve, 300));
        fromPage.style.display = 'none';
        fromPage.classList.remove('hiding');
    }
    
    if (toPage) {
        // 设置正确的display类型
        if (toPageDisplayType) {
            toPage.style.display = toPageDisplayType;
        } else if (toPage.classList.contains('container')) {
            toPage.style.display = 'flex'; // 容器应该是flex布局
        } else {
            toPage.style.display = 'block';
        }
        
        toPage.classList.add('showing');
        setTimeout(() => {
            toPage.classList.remove('showing');
        }, 300);
    }
}

// 生成高熵随机字符串
function generateHighEntropyString() {
    const array = new Uint8Array(32);
    window.crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

// SHA-256加密函数
async function sha256Encrypt(text) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 检查登录状态
async function checkAuthStatus() {
    if (!authToken) {
        updateAuthUI(false);
        return;
    }
    
    try {
        const response = await fetch('/api/user/status', {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (!response.ok) {
            throw new Error('网络响应不正常');
        }
        
        const data = await response.json();
        
        if (data.logged_in) {
            currentUser = data.user;
            updateAuthUI(true);
        } else {
            updateAuthUI(false);
            localStorage.removeItem('auth_token');
            authToken = null;
        }
    } catch (error) {
        console.error('检查登录状态失败:', error);
        updateAuthUI(false);
    }
}

// 更新认证UI
function updateAuthUI(isLoggedIn) {
    const authContainer = document.getElementById('auth-container');
    
    if (isLoggedIn && currentUser) {
        authContainer.innerHTML = `
            <div class="user-info">
                <img src="${currentUser.avatar}" alt="头像" class="user-avatar">
                <span class="username">${currentUser.username}</span>
                <button class="logout-btn" id="logoutBtn">
                    <i class="fas fa-sign-out-alt"></i> 退出
                </button>
            </div>
        `;
        
        document.getElementById('logoutBtn').addEventListener('click', logout);
    } else {
        authContainer.innerHTML = `
            <button class="login-btn" id="loginBtn">
                <i class="fas fa-sign-in-alt"></i> 登录
            </button>
        `;
        
        document.getElementById('loginBtn').addEventListener('click', ssoLogin);
    }
}

// SSO登录
async function ssoLogin() {
    try {
        // 1. 生成高熵随机字符串
        const randomString = generateHighEntropyString();
        
        // 2. 加密字符串
        const encryptedString = await sha256Encrypt(randomString);
        
        // 3. 将随机字符串保存到sessionStorage
        sessionStorage.setItem('sso_random_string', randomString);
        sessionStorage.setItem('sso_encrypted_string', encryptedString);
        
        // 4. 直接跳转到SSO页面
        const ssoUrl = `https://www.kish.top/sso/?appid=blog&msg=${encryptedString}`;
        window.location.href = ssoUrl;
        
    } catch (error) {
        console.error('登录失败:', error);
        alert('登录失败，请重试');
    }
}

// 验证请求
async function verifyAuth(au) {
    // 从sessionStorage获取随机字符串
    const randomString = sessionStorage.getItem('sso_random_string');
    
    if (!randomString) {
        alert('验证失败：找不到验证信息');
        return;
    }
    
    try {
        const response = await fetch('/api/sso/verify', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                au: au,
                random_string: randomString
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || '验证失败');
        }
        
        const data = await response.json();
        
        if (data.success) {
            // 保存token
            authToken = data.token;
            localStorage.setItem('auth_token', data.token);
            
            // 更新用户状态
            currentUser = data.user;
            updateAuthUI(true);
            
            // 清理sessionStorage
            sessionStorage.removeItem('sso_random_string');
            sessionStorage.removeItem('sso_encrypted_string');
            
            alert('登录成功！');
        } else {
            alert('验证失败');
        }
    } catch (error) {
        console.error('验证失败:', error);
        alert('验证失败: ' + error.message);
    }
}

// 检查URL中是否有验证参数
function checkAuthParam() {
    const urlParams = new URLSearchParams(window.location.search);
    const au = urlParams.get('au');
    
    if (au) {
        // 发送验证请求
        verifyAuth(au);
        
        // 清理URL中的参数
        const newUrl = window.location.pathname;
        window.history.replaceState({}, document.title, newUrl);
    }
}

// 退出登录
async function logout() {
    if (!authToken) return;
    
    try {
        const response = await fetch('/api/user/logout', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.ok) {
            localStorage.removeItem('auth_token');
            authToken = null;
            currentUser = null;
            updateAuthUI(false);
            alert('已退出登录');
        }
    } catch (error) {
        console.error('退出失败:', error);
        alert('退出失败');
    }
}

// 防止XSS攻击的HTML转义函数
function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return unsafe;
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// 时间格式化
function formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    const minute = 60 * 1000;
    const hour = minute * 60;
    const day = hour * 24;
    
    if (diff < minute) {
        return '刚刚';
    } else if (diff < hour) {
        return `${Math.floor(diff / minute)}分钟前`;
    } else if (diff < day) {
        return `${Math.floor(diff / hour)}小时前`;
    } else if (diff < day * 7) {
        return `${Math.floor(diff / day)}天前`;
    } else {
        return date.toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }
}

// 帖子详情页面功能 - 在post-list中替换
let currentPostId = null;
let cachedPosts = []; // 缓存帖子列表数据

// 路由函数 - 检测URL路径
function handleRoute() {
    const path = window.location.pathname;
    
    // 检查是否是帖子详情路径，格式为 /post/{id}
    const postMatch = path.match(/^\/post\/(\d+)$/);
    
    if (postMatch) {
        const postId = parseInt(postMatch[1]);
        openPostDetail(postId);
    } else {
        // 显示帖子列表
        showPostList();
    }
}

// 显示帖子列表
function showPostList() {
    const postListContainer = document.getElementById('post-list');
    if (!postListContainer) return;
    
    // 移除目录（如果存在）
    removeToc();
    
    // 移除详情页面（如果存在）
    const postDetailElement = document.getElementById('post-detail');
    if (postDetailElement) {
        postDetailElement.remove();
    }
    
    // 显示帖子列表容器
    postListContainer.style.display = 'grid';
    
    // 添加淡入动画
    postListContainer.classList.add('fade-in-up');
    
    // 如果已经有缓存的数据，直接使用
    if (cachedPosts.length > 0) {
        renderPostList(cachedPosts);
    } else {
        // 否则重新加载
        loadPosts();
    }
}
function backHome() {
    // 如果追番模态框打开，则关闭它
    if (isAnimeModalOpen) {
        closeAnimeModal();
    }
    showPostList();
    // 如果当前在帖子详情页，模拟点击返回列表按钮
    const postDetail = document.getElementById('post-detail');
    const backToListBtn = document.getElementById('backToListBtn');
    
    if (postDetail) {
        // 如果存在返回按钮，模拟点击
        if (backToListBtn) {
            backToListBtn.click();
        } else {
            // 否则手动执行返回逻辑
            // 移除目录（如果存在）
            removeToc();
            document.title = "秋名山香蕉 Blog";
            
            // 返回列表时添加退出动画
            postDetail.classList.remove('active');
            postDetail.classList.add('slide-out-down');
            
            setTimeout(() => {
                // 恢复URL
                window.history.pushState({}, '', '/');
            }, 300);
        }
    } else {
        // 如果不在详情页，直接显示帖子列表
        // 恢复URL
        window.history.pushState({}, '', '/');
        
        // 如果搜索下拉菜单是打开的，关闭它
        if (activeDropdown === 'search') {
            hideDropdown('search');
        }
        
        // 清空搜索输入框
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.value = '';
        }
        
        // 清空搜索结果
        clearSearchResults();

            
            // 平滑滚动到标题位置
            window.scrollTo({
                top: 600,
                behavior: 'smooth'
            });
    }
}
// 打开帖子详情
async function openPostDetail(postId) {
    currentPostId = postId;
    
    // 更新URL
    window.history.pushState({}, '', `/post/${postId}`);
    
    const postListContainer = document.getElementById('post-list');
    if (!postListContainer) return;
    
    // 获取缓存数据
    const cachedPost = cachedPosts.find(post => post.id === postId);
    
    // 创建临时数据
    let tempTitle = '加载中...';
    let tempContent = '正在加载帖子内容...';
    let tempUsername = '匿名';
    let tempCreatedAt = new Date().toISOString();
    
    if (cachedPost) {
        tempTitle = cachedPost.title;
        tempContent = cachedPost.content.substring(0, 500) + (cachedPost.content.length > 500 ? '...' : '');
        tempUsername = cachedPost.username || '匿名';
        tempCreatedAt = cachedPost.created_at;
    }
    
    // 先让文章列表向下淡出
    postListContainer.classList.add('fading-out');
    postListContainer.style.transform = 'translateY(50px)';
    postListContainer.style.opacity = '0';
    
    // 等待动画完成
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // 清空容器并添加详情内容（包含许可协议）
    postListContainer.innerHTML = `
        <div id="post-detail" class="post-detail">
            <button id="backToListBtn" class="back-to-list-btn">
                <i class="fas fa-arrow-left"></i> 返回列表
            </button>
            <div class="post-detail-content">
                <h1 class="post-detail-title" id="post-detail-title">${tempTitle}</h1>
                
                <div class="post-meta">
                    <span><i class="far fa-calendar"></i> ${formatTime(tempCreatedAt)}</span>
                    <span><i class="far fa-user"></i> ${escapeHtml(tempUsername)}</span>
                </div>
                
                <div class="post-content markdown-content" id="postContent">
                    ${marked.parse(tempContent)}
                </div>
                
                <div class="article-footer">
                    <section id="license">
                        <div class="header"><span>许可协议</span></div>
                        <div class="body">
                            <p>本文采用 <a target="_blank" rel="noopener" href="https://creativecommons.org/licenses/by-nc-sa/4.0/">署名-非商业性使用-相同方式共享 4.0 国际</a> 许可协议，转载请注明出处。</p>
                        </div>
                    </section>
                </div>
                
                <div class="loading-indicator" id="loadingIndicator">
                    <i class="fas fa-spinner fa-spin"></i> 加载详细内容...
                </div>
                
                <div class="comments-section" id="commentsSection" style="display: none;">
                    <h3>评论 (<span id="commentCount">0</span>)</h3>
                    <div id="commentsList" class="comments-list"></div>
                    
                    <div class="comment-form">
                        <textarea id="commentInput" placeholder="发表评论..." rows="3"></textarea>
                        <button id="submitComment" class="btn-primary">发表评论</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // 重置动画状态
    postListContainer.classList.remove('fading-out');
    postListContainer.style.transform = '';
    postListContainer.style.opacity = '';
    
    // 设置详情页初始状态（在屏幕下方）
    const postDetail = document.getElementById('post-detail');
    postDetail.classList.add('slide-in-up');
    
    // 添加显示动画
    setTimeout(() => {
        postDetail.classList.add('active');
    }, 50);
    
    // 绑定事件
    document.getElementById('backToListBtn').addEventListener('click', () => {
        // 移除目录（如果存在）
        removeToc();
        document.title = "秋名山香蕉 Blog";
        // 返回列表时添加退出动画
        postDetail.classList.remove('active');
        postDetail.classList.add('slide-out-down');
        
        setTimeout(() => {
            // 恢复URL
            window.history.pushState({}, '', '/');
            showPostList();
        }, 300);
    });
    document.getElementById('submitComment').addEventListener('click', submitComment);
    
    // 加载完整内容和评论
    loadPostDetail(postId);
    
    // 滚动到标题位置
    setTimeout(() => {
        const titleElement = document.getElementById('post-detail-title');
        if (titleElement) {
            const navbar = document.querySelector('.navbar');
            const navbarHeight = 70;
            const banner = document.querySelector('.banner');
            const bannerHeight = 150;
            
            // 计算标题位置，考虑导航栏和banner的高度
            const titleRect = titleElement.getBoundingClientRect();
            const scrollPosition = window.pageYOffset + titleRect.top - navbarHeight - bannerHeight;
            
            // 平滑滚动到标题位置
            window.scrollTo({
                top: scrollPosition,
                behavior: 'smooth'
            });
        }
    }, 350); // 稍微延迟一点，确保动画完成后再滚动
}

// 修改 loadPostDetail 函数，添加自定义标签处理
async function loadPostDetail(postId) {
    try {
        const response = await fetch(`/api/posts/${postId}`);
        
        if (!response.ok) {
            throw new Error('加载失败');
        }
        
        const data = await response.json();
        
        // 隐藏加载指示器
        const loadingIndicator = document.getElementById('loadingIndicator');
        if (loadingIndicator) {
            loadingIndicator.style.display = 'none';
        }
        
        // 更新标题和元数据
        const postDetailTitle = document.querySelector('.post-detail-title');
        if (postDetailTitle && data.post.title) {
            postDetailTitle.textContent = data.post.title;
        }
        
        // 更新内容 - 先解析Markdown，然后处理自定义标签
        const postContentElement = document.getElementById('postContent');
        if (postContentElement) {
            // 解析Markdown为HTML
            let htmlContent = marked.parse(data.post.content);
            
            // 处理自定义标签（GitHub仓库引用和文件下载）
            htmlContent = await processCustomTags(htmlContent);
            
            // 更新内容
            postContentElement.innerHTML = htmlContent;
            
            // 检查是否为宽屏，如果是则生成目录
            checkScreenWidthAndGenerateToc();
        }
        
        // 更新元数据
        const metaElement = document.querySelector('.post-detail-content .post-meta');
        if (metaElement && data.post) {
            metaElement.innerHTML = `
                <span><i class="far fa-calendar"></i> ${formatTime(data.post.created_at)} （最后更新于 ${formatTime(data.post.updated_at)}）</span>
                <span><i class="far fa-eye"></i> ${data.post.view_count || 0}</span>
                <span><i class="far fa-comment"></i> ${data.post.comment_count || 0}</span>
                <span><i class="fas fa-folder"></i> ${data.post.category || '匿名'}</span>
                <span><i class="fas fa-tag"></i> ${data.post.tags || 'Tag'}</span>
            `;
        }

        document.title = escapeHtml(data.post.title);

        // 显示评论区域
        const commentsSection = document.getElementById('commentsSection');
        if (commentsSection) {
            commentsSection.style.display = 'block';
        }
        
        const commentCount = document.getElementById('commentCount');
        if (commentCount) {
            commentCount.textContent = data.post.comment_count || 0;
        }
        
        // 渲染评论
        renderComments(data.comments || []);
        
        // 动画效果
        setTimeout(() => {
            document.querySelectorAll('.comment-item').forEach((item, index) => {
                item.style.animationDelay = `${index * 0.1}s`;
                item.classList.add('fade-in');
            });
        }, 100);
        
    } catch (error) {
        console.error('加载帖子详情失败:', error);
        const loadingIndicator = document.getElementById('loadingIndicator');
        if (loadingIndicator) {
            loadingIndicator.innerHTML = '<i class="fas fa-exclamation-triangle"></i> 帖子不存在';
        }
    }
}

// 检查屏幕宽度并生成目录
function checkScreenWidthAndGenerateToc() {
    isWideScreen = window.innerWidth > 1600;
    if (isWideScreen) {
        generateToc();
    }
}

// 生成目录函数
function generateToc() {
    const postContent = document.getElementById('postContent');
    if (!postContent) return;
    
    // 移除已有的目录
    removeToc();
    
    // 获取所有标题元素
    const headings = postContent.querySelectorAll('h1, h2, h3');
    if (headings.length === 0) return;
    
    // 创建目录容器 - 直接添加到 body
    tocContainer = document.createElement('div');
    tocContainer.className = 'toc-container';
    tocContainer.innerHTML = `
        <div class="toc-header">
            <h3><i class="fas fa-list"></i> 目录</h3>
            <button class="toc-toggle" id="tocToggle">
                <i class="fas fa-chevron-up"></i>
            </button>
        </div>
        <div class="toc-content" id="tocContent">
            <ul class="toc-list"></ul>
        </div>
    `;
    
    // 将目录直接添加到 body
    document.body.appendChild(tocContainer);
    
    const tocList = tocContainer.querySelector('.toc-list');
    let tocData = [];
    
    // 构建目录数据并添加标题ID
    headings.forEach((heading, index) => {
        const level = parseInt(heading.tagName.charAt(1));
        const text = heading.textContent;
        
        // 如果没有id，添加一个
        if (!heading.id) {
            heading.id = `heading-${index}`;
        }
        
        // 添加锚点链接
        if (!heading.querySelector('.toc-anchor')) {
            const anchor = document.createElement('a');
            anchor.className = 'toc-anchor';
            anchor.href = `#${heading.id}`;
            anchor.innerHTML = '<i class="fas fa-link"></i>';
            heading.style.position = 'relative';
            anchor.style.position = 'absolute';
            anchor.style.left = '-25px';
            anchor.style.top = '50%';
            anchor.style.transform = 'translateY(-50%)';
            anchor.style.opacity = '0';
            anchor.style.transition = 'opacity 0.2s ease';
            anchor.style.textDecoration = 'none';
            anchor.style.color = 'var(--accent-color)';
            anchor.style.fontSize = '0.9rem';
            
            heading.appendChild(anchor);
            
            // 鼠标悬停显示锚点
            heading.addEventListener('mouseenter', () => {
                anchor.style.opacity = '0.7';
            });
            
            heading.addEventListener('mouseleave', () => {
                anchor.style.opacity = '0';
            });
        }
        
        const tocItem = {
            id: heading.id,
            level: level,
            text: text,
            element: heading
        };
        
        tocData.push(tocItem);
    });
    
    // 保存目录数据
    currentToc = tocData;
    
    // 构建目录树
    let lastLevel = 0;
    let currentParent = tocList;
    const parentStack = [tocList];
    const levelStack = [0];
    
    tocData.forEach((item, index) => {
        const li = document.createElement('li');
        li.className = `toc-level-${item.level}`;
        
        const a = document.createElement('a');
        a.href = `#${item.id}`;
        a.className = 'toc-link';
        a.textContent = item.text;
        a.dataset.level = item.level;
        
        li.appendChild(a);
        
        // 处理层级关系
        if (item.level > lastLevel) {
            // 进入更深层级
            const lastLi = parentStack[parentStack.length - 1].lastElementChild;
            if (lastLi) {
                let subUl = lastLi.querySelector('ul');
                if (!subUl) {
                    subUl = document.createElement('ul');
                    subUl.className = 'toc-sub-list';
                    lastLi.appendChild(subUl);
                }
                parentStack.push(subUl);
                levelStack.push(item.level);
                currentParent = subUl;
            }
        } else if (item.level < lastLevel) {
            // 返回较浅层级
            while (levelStack.length > 0 && levelStack[levelStack.length - 1] >= item.level) {
                parentStack.pop();
                levelStack.pop();
            }
            currentParent = parentStack[parentStack.length - 1];
        }
        
        // 添加到当前父级
        currentParent.appendChild(li);
        lastLevel = item.level;
        
        // 添加点击事件
        a.addEventListener('click', (e) => {
            e.preventDefault();
            smoothScrollTo(item.element);
            
            // 添加点击反馈
            a.classList.add('clicked');
            setTimeout(() => {
                a.classList.remove('clicked');
            }, 300);
        });
    });
    
    // 绑定目录折叠/展开事件
    const tocToggle = document.getElementById('tocToggle');
    const tocContent = document.getElementById('tocContent');
    
    if (tocToggle && tocContent) {
        tocToggle.addEventListener('click', () => {
            tocContent.classList.toggle('collapsed');
            const icon = tocToggle.querySelector('i');
            if (tocContent.classList.contains('collapsed')) {
                icon.className = 'fas fa-chevron-down';
            } else {
                icon.className = 'fas fa-chevron-up';
            }
        });
    }
    
    // 初始化目录位置
    updateTocPosition();
    
    // 监听滚动，高亮当前章节
    window.addEventListener('scroll', highlightCurrentTocItem);
    
    // 监听窗口大小变化，调整目录位置
    window.addEventListener('resize', updateTocPosition);
}

// 更新目录位置函数 - 固定在右上角
function updateTocPosition() {
    if (!tocContainer) return;
    
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    
    // 固定在视口右上角，距离顶部 100px，右侧 20px
    const topPosition = 100;
    const rightPosition = 20;
    
    // 设置固定位置
    tocContainer.style.top = topPosition + 'px';
    tocContainer.style.right = rightPosition + 'px';
    tocContainer.style.position = 'fixed';
    
    // 确保目录不超出可视区域
    const tocHeight = tocContainer.offsetHeight;
    const viewportHeight = window.innerHeight;
    
    // 如果目录高度超过可视区域，限制最大高度
    if (tocHeight > viewportHeight - 150) {
        tocContainer.querySelector('.toc-content').style.maxHeight = (viewportHeight - 150) + 'px';
    }
}
// 修改高亮当前章节函数
function highlightCurrentTocItem() {
    if (!currentToc || !tocContainer) return;
    const chufa = window.innerHeight / 854;
    const chufa1 = chufa * 250;
    const markerPosition = window.scrollY - window.innerHeight + chufa1; // 视口下方100px的位置
    let activeId = null;
    let closestDistance = Infinity;
    
    // 遍历所有标题，找到距离标记位置最近且在其上方的标题
    for (let i = 0; i < currentToc.length; i++) {
        const item = currentToc[i];
        const element = document.getElementById(item.id);
        
        if (!element) continue;
        
        const distance = markerPosition - element.offsetTop;
        
        // 如果标题在标记位置上方（包括刚好在标记位置）
        if (distance >= 0) {
            // 选择距离标记位置最近（最小非负距离）的标题
            if (distance < closestDistance) {
                closestDistance = distance;
                activeId = item.id;
            }
        }
    }
    
    // 如果所有标题都在标记位置下方，高亮第一个标题
    if (!activeId && currentToc.length > 0) {
        activeId = currentToc[0].id;
    }
    
    // 更新高亮状态
    const tocLinks = tocContainer.querySelectorAll('.toc-link');
    tocLinks.forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href') === `#${activeId}`) {
            link.classList.add('active');
        }
    });
}
// 平滑滚动到指定元素
function smoothScrollTo(element) {
    const offset = 85; // 考虑固定导航栏的高度
    const elementPosition = element.getBoundingClientRect().top;
    const offsetPosition = elementPosition + window.pageYOffset - offset;
    
    window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth'
    });
    
    // 修改URL hash（但不触发页面跳转）
    history.replaceState(null, null, `#${element.id}`);
}
// 移除目录
function removeToc() {
    if (tocContainer) {
        tocContainer.remove();
        tocContainer = null;
    }
    currentToc = null;
    window.removeEventListener('scroll', highlightCurrentTocItem);
    window.removeEventListener('resize', updateTocPosition);
}

// 渲染评论
function renderComments(comments) {
    const commentsList = document.getElementById('commentsList');
    if (!commentsList) return;
    
    const commentMap = {};
    const rootComments = [];
    
    // 构建评论树
    comments.forEach(comment => {
        comment.replies = [];
        commentMap[comment.id] = comment;
        
        if (comment.parent_id === 0) {
            rootComments.push(comment);
        } else if (commentMap[comment.parent_id]) {
            commentMap[comment.parent_id].replies.push(comment);
        }
    });
    
    // 渲染评论
    commentsList.innerHTML = rootComments.map(comment => renderCommentItem(comment, 0)).join('');
}

// 渲染单个评论项
function renderCommentItem(comment, depth) {
    const indent = depth * 20;
    const parentUsername = comment.parent_username ? `<span class="reply-to">回复@${comment.parent_username}</span>` : '';
    
    return `
        <div class="comment-item" data-comment-id="${comment.id}" style="margin-left: ${indent}px">
            <div class="comment-header">
                <img src="${comment.avatar || 'https://q1.qlogo.cn/g?b=qq&nk=64072478&s=640'}" 
                     alt="头像" class="comment-avatar">
                <div>
                    <span class="comment-author">${comment.username || '匿名用户'}</span>
                    ${parentUsername}
                    <span class="comment-time">${formatTime(comment.created_at)}</span>
                </div>
            </div>
            <div class="comment-content">${escapeHtml(comment.content)}</div>
            <button class="reply-btn" onclick="showReplyForm(${comment.id})">
                <i class="fas fa-reply"></i> 回复
            </button>
            ${comment.replies.map(reply => renderCommentItem(reply, depth + 1)).join('')}
        </div>
    `;
}

// 全局变量
let replyingTo = null;

function showReplyForm(commentId) {
    if (!currentUser) {
        alert('请先登录才能回复');
        return;
    }
    
    replyingTo = commentId;
    
    // 移除现有的回复表单
    const existingForm = document.querySelector('.reply-form');
    if (existingForm) {
        existingForm.remove();
    }
    
    // 创建新的回复表单
    const commentItem = document.querySelector(`[data-comment-id="${commentId}"]`);
    if (commentItem) {
        const replyForm = document.createElement('div');
        replyForm.className = 'reply-form';
        replyForm.innerHTML = `
            <form class="reply-form-inner">
                <textarea 
                    id="reply-textarea-${commentId}" 
                    name="reply" 
                    class="reply-form" 
                    placeholder="回复评论..."
                    aria-label="回复内容"
                    rows="3"
                ></textarea>
                <div style="margin-top: 10px;">
                    <button type="submit" id="sbreply" class="btn-primary">回复</button>
                    <button type="button" class="btn-primary" style="margin-left: 10px; background: #bcbcbc;">取消</button>
                </div>
            </form>
        `;
        commentItem.appendChild(replyForm);
        
        // 为表单添加事件监听器
        const form = replyForm.querySelector('.reply-form-inner');
        const submitBtn = replyForm.querySelector('.btn-primary');
        const cancelBtn = replyForm.querySelector('.btn-secondary');
        
        // 修复：移除原来的内联事件，添加新的监听器
        form.addEventListener('submit', function(event) {
            event.preventDefault();
            submitReply();
        });
        
        submitBtn.addEventListener('click', function(event) {
            event.preventDefault();
            submitReply();
        });
        
        cancelBtn.addEventListener('click', function(event) {
            event.preventDefault();
            cancelReply();
        });
        
        // 自动聚焦到输入框
        setTimeout(() => {
            const textarea = document.getElementById(`reply-textarea-${commentId}`);
            if (textarea) {
                textarea.focus();
            }
        }, 100);
    }
}

// 提交回复
async function submitReply() {
    if (!replyingTo) {
        alert('回复目标不存在');
        return;
    }
    
    // 修复：使用正确的textarea ID获取内容
    const textarea = document.getElementById(`reply-textarea-${replyingTo}`);
    if (!textarea) {
        alert('无法找到回复输入框');
        return;
    }
    
    const content = textarea.value.trim();
    
    if (!content) {
        alert('请输入回复内容');
        textarea.focus();
        return;
    }
    const submitreplyBtn = document.getElementById('sbreply');
    
        submitreplyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 提交中...';
        submitreplyBtn.disabled = true;

    try {
        const response = await fetch(`/api/posts/${currentPostId}/comments`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                content: content,
                parent_id: replyingTo
            })
        });
        
        if (response.ok) {
            if (typeof loadPostDetail === 'function') {
                loadPostDetail(currentPostId); // 重新加载评论
            }
            cancelReply();
        } else {
            const errorData = await response.json();
            alert('回复失败: ' + (errorData.error || '未知错误'));
        }
    } catch (error) {
        console.error('回复失败:', error);
        alert('回复失败，请重试');
    }
}

// 取消回复
function cancelReply() {
    const replyForm = document.querySelector('.reply-form');
    if (replyForm) {
        replyForm.remove();
    }
    replyingTo = null;
}

// 提交评论
async function submitComment() {
    const commentInput = document.getElementById('commentInput');
    const content = commentInput.value.trim();
    
    if (!content) {
        alert('请输入评论内容');
        return;
    }
    
    if (!currentUser) {
        alert('请先登录');
        return;
    }
    
    const submitBtn = document.getElementById('submitComment');
    const originalText = submitBtn.textContent;
    
    try {
        // 添加加载状态
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 提交中...';
        submitBtn.disabled = true;
        
        const response = await fetch(`/api/posts/${currentPostId}/comments`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                content: escapeHtml(content), // 评论内容仍需转义
                parent_id: null
            })
        });
        
        if (response.ok) {
            // 添加成功动画
            submitBtn.innerHTML = '<i class="fas fa-check"></i> 成功！';
            submitBtn.style.backgroundColor = '#28a745';
            
            setTimeout(() => {
                commentInput.value = '';
                loadPostDetail(currentPostId); // 重新加载评论
                submitBtn.innerHTML = originalText;
                submitBtn.style.backgroundColor = '';
                submitBtn.disabled = false;
            }, 1000);
        } else {
            const errorData = await response.json();
            throw new Error(errorData.error || '未知错误');
        }
    } catch (error) {
        console.error('评论失败:', error);
        submitBtn.innerHTML = '<i class="fas fa-times"></i> 失败';
        submitBtn.style.backgroundColor = '#dc3545';
        
        setTimeout(() => {
            submitBtn.innerHTML = originalText;
            submitBtn.style.backgroundColor = '';
            submitBtn.disabled = false;
        }, 2000);
        
        alert('评论失败: ' + error.message);
    }
}

// 渲染帖子列表
function renderPostList(posts) {
    const postListContainer = document.getElementById('post-list');
    if (!postListContainer) return;
    
    const postsHTML = posts.map(post => `
        <div class="post-card" onclick="openPostDetail(${post.id})">
            <h3 class="post-title">${escapeHtml(post.title)}</h3>
            <div class="post-meta">
                <span><i class="far fa-calendar"></i> ${formatTime(post.created_at)}</span>
                <span><i class="far fa-eye"></i> ${post.view_count || 0}</span>
                <span><i class="far fa-comment"></i> ${post.comment_count || 0}</span>
                <span><i class="fas fa-folder"></i> ${post.category || '匿名'}</span>
                <span><i class="fas fa-tag"></i> ${post.tags || 'Tag'}</span>
            </div>
            <p class="post-excerpt">${escapeHtml(post.content.substring(0, 200))}...</p>
            <a href="javascript:void(0)" class="read-more" onclick="openPostDetail(${post.id}); event.stopPropagation();">
                阅读更多 <i class="fas fa-arrow-right"></i>
            </a>
        </div>
    `).join('');
    
    postListContainer.innerHTML = postsHTML;
    postListContainer.style.display = 'grid';
    
    // 添加卡片动画
    setTimeout(() => {
        document.querySelectorAll('.post-card').forEach((card, index) => {
            card.style.animationDelay = `${index * 0.1}s`;
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
        });
    }, 100);
}

// 加载帖子列表
function loadPosts() {
    fetch('/api/posts')
        .then(response => {
            if (!response.ok) {
                throw new Error('网络响应不正常');
            }
            return response.json();
        })
        .then(posts => {
            // 缓存帖子数据
            cachedPosts = posts;
            
            // 渲染帖子列表
            renderPostList(posts);
        })
        .catch(error => {
            console.error('获取帖子列表失败:', error);
            const postListContainer = document.getElementById('post-list');
            if (postListContainer) {
                postListContainer.innerHTML = '<p>加载失败，请稍后重试</p>';
            }
        });
}

// 修改追番页面加载函数
async function loadAnimeList() {
    try {
        const response = await fetch('/api/anime', {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.status === 401) {
            alert('请先登录查看追番列表');
            return;
        }
        
        if (!response.ok) {
            throw new Error('加载失败');
        }
        
        const animeList = await response.json();
        
        // 对追番列表进行排序（不改变原始数组结构）
        const sortedAnimeList = [...animeList].sort((a, b) => {
            // 1. 按状态排序：已看完 > 追番中 > 暂停 > 弃坑
            const statusOrder = {
                'completed': 1,
                'watching': 2,
                'paused': 3,
                'dropped': 4
            };
            
            const statusA = statusOrder[a.status] || 5;
            const statusB = statusOrder[b.status] || 5;
            
            if (statusA !== statusB) {
                return statusA - statusB;
            }
            
            // 2. 如果都是已看完状态，按追完日期从古到今排序
            if (a.status === 'completed' && b.status === 'completed') {
                if (!a.completed_date && !b.completed_date) return 0;
                if (!a.completed_date) return 1; // 没有追完日期的排后面
                if (!b.completed_date) return -1; // 没有追完日期的排后面
                
                // 比较日期，从古到今（越早的日期越小）
                const dateA = new Date(a.completed_date);
                const dateB = new Date(b.completed_date);
                
                if (dateA < dateB) return -1;
                if (dateA > dateB) return 1;
                return 0;
            }
            
            // 3. 如果是其他相同状态，按创建时间从新到旧排序
            const dateA = new Date(a.created_at);
            const dateB = new Date(b.created_at);
            
            // 从新到旧（越新的日期越大）
            if (dateA > dateB) return -1;
            if (dateA < dateB) return 1;
            return 0;
        });
        
        // 使用排序后的列表进行渲染，保持原有渲染方式不变
        renderAnimeList(sortedAnimeList);
    } catch (error) {
        console.error('加载追番列表失败:', error);
        alert('加载失败，请重试');
    }
}
function renderAnimeList(animeList) {
    const animeGrid = document.getElementById('animeGrid');
    
    // 构建追番HTML
    const animeHTML = animeList.map((anime, index) => {
        // 处理追完时间显示
        let completedDateDisplay = '';
        if (anime.completed_date) {
            const date = new Date(anime.completed_date);
            completedDateDisplay = `<span class="completed-date">追完于: ${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}</span>`;
        }
        
        
        // 状态文本映射
        const statusTexts = {
            'watching': '追番中',
            'completed': '已看完',
            'paused': '暂停',
            'dropped': '弃坑'
        };
        
        const statusText = statusTexts[anime.status] || anime.status;
        const statusClass = anime.status === 'completed' ? 'completed' : 
                           anime.status === 'watching' ? 'watching' :
                           anime.status === 'paused' ? 'paused' : 'dropped';
        
        return `
        <div class="anime-card" style="animation-delay: ${index * 0.1}s">
            <img src="${anime.cover_url || 'https://via.placeholder.com/300x400?text=No+Image'}" 
                 alt="${escapeHtml(anime.title)}" 
                 class="anime-cover" 
                 onerror="this.src='https://via.placeholder.com/300x400?text=No+Image'">
            <div class="anime-info">
                <h3>${escapeHtml(anime.title)}</h3>
                <div class="anime-details">
                    <span class="anime-status ${statusClass}">${statusText}</span>
                </div>
                ${completedDateDisplay}
                ${anime.notes ? `<p class="anime-notes">${escapeHtml(anime.notes)}</p>` : ''}
            </div>
        </div>
        `;
    }).join('');
    
    // 更新追番列表内容
    animeGrid.innerHTML = animeHTML || '<p class="no-anime">暂无追番记录</p>';
}

// 在 DOMContentLoaded 中，修改这部分代码：
document.addEventListener('DOMContentLoaded', () => {
    handleRoute();
    
    // 然后检查认证状态
    checkAuthStatus();
    checkAuthParam();
    
    // 移除原有的追番页面元素
    const oldAnimePage = document.getElementById('animePage');
    if (oldAnimePage) {
        oldAnimePage.remove();
    }
    
    // 初始化下拉菜单
    initDropdowns();
    
    // 初始化搜索功能
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const keyword = e.target.value.trim();
            
            // 清除之前的定时器
            if (searchTimeout) {
                clearTimeout(searchTimeout);
            }
            
            // 防抖处理，500ms后执行搜索
            searchTimeout = setTimeout(() => {
                searchPosts(keyword);
            }, 500);
        });
        
        // 回车键搜索
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const keyword = e.target.value.trim();
                if (keyword) {
                    searchPosts(keyword);
                }
            }
        });
        
        // 失去焦点时延迟隐藏下拉菜单
        searchInput.addEventListener('blur', () => {
            setTimeout(() => {
                const isFocusing = document.activeElement === searchInput || 
                                  document.querySelector('.search-result-item:hover');
                if (!isFocusing && activeDropdown === 'search') {
                    hideDropdown('search');
                }
            }, 200);
        });
    }
    
    // 追番链接点击事件
    const animeLink = document.getElementById('animeLink');
    if (animeLink) {
        animeLink.addEventListener('click', (e) => {
            e.preventDefault();
            openAnimeModal();
        });
    }
    
    // 追番模态框关闭按钮
    const animeModalCloseBtn = animeModal.querySelector('.close-modal');
    if (animeModalCloseBtn) {
        animeModalCloseBtn.addEventListener('click', closeAnimeModal);
    }
    
    // 点击模态框外部关闭
    animeModal.addEventListener('click', (e) => {
        if (e.target === animeModal) {
            closeAnimeModal();
        }
    });
    
    // ESC键关闭追番模态框
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isAnimeModalOpen) {
            closeAnimeModal();
        }
    });
    
    // 修改导航栏追番链接
    document.querySelectorAll('.nav-links a')[1].addEventListener('click', (e) => {
        e.preventDefault();
        if (!currentUser) {
            alert('请先登录查看追番列表');
            ssoLogin();
        } else {
            loadAnimeList();
        }
    });
    
    // 监听popstate事件，处理浏览器前进/后退
    window.addEventListener('popstate', handleRoute);
    
    // 监听窗口大小变化，动态显示/隐藏目录
    window.addEventListener('resize', () => {
        const oldWideScreen = isWideScreen;
        isWideScreen = window.innerWidth > 1600;
        
        // 如果当前在详情页且屏幕宽度状态发生变化
        if (currentPostId && oldWideScreen !== isWideScreen) {
            if (isWideScreen) {
                generateToc();
            } else {
                removeToc();
            }
        }
    });
});

// 原有的其他事件监听器
window.addEventListener('scroll', function() {
    const navbar = document.querySelector('.navbar');
    if (window.scrollY > 50) {
        navbar.classList.add('scrolled');
    } else {
        navbar.classList.remove('scrolled');
    }
});

const themeToggle = document.getElementById('themeToggle');
themeToggle.addEventListener('click', function() {
    document.body.classList.toggle('dark-theme');
    
    const icon = themeToggle.querySelector('i');
    if (document.body.classList.contains('dark-theme')) {
        icon.classList.remove('fa-moon');
        icon.classList.add('fa-sun');
    } else {
        icon.classList.remove('fa-sun');
        icon.classList.add('fa-moon');
    }
});

// 窗口大小变化时调整下拉菜单行为
window.addEventListener('resize', () => {
    // 在移动设备上禁用悬停效果
    if (window.innerWidth <= 768 && activeDropdown) {
        hideDropdown(activeDropdown);
    }
});