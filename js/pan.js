// 配置
        const CONFIG = {
            API_BASE: '/api', // 边缘函数API地址
            SPACE_ID: 's.ww497d2a82f9615a88.768635337y2K'
        };

        // 全局状态
        let currentFolderId = CONFIG.SPACE_ID;
        let currentSort = 1;
        let user = null;
        let breadcrumb = [];
        let downloads = [];

        // DOM元素
        const fileListEl = document.getElementById('fileList');
        const loadingEl = document.getElementById('loading');
        const emptyStateEl = document.getElementById('emptyState');
        const userInfoEl = document.getElementById('userInfo');
        const breadcrumbEl = document.getElementById('breadcrumb');
        const downloadTrayEl = document.getElementById('downloadTray');
        const trayContentEl = document.getElementById('trayContent');
        const trayCountEl = document.getElementById('trayCount');
        const trayHeaderEl = document.getElementById('trayHeader');
        const trayToggleEl = document.getElementById('trayToggle');

        // 工具函数：格式化文件大小
        function formatFileSize(bytes) {
            if (bytes === 0) return '0 B';
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        }

        // 工具函数：格式化时间戳
        function formatTimestamp(timestamp) {
            const date = new Date(timestamp * 1000);
            return date.toLocaleDateString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        }

        // 工具函数：获取文件图标
        function getFileIcon(fileType) {
            switch(fileType) {
                case 1: return 'fa-folder'; // 文件夹
                case 2: return 'fa-file';   // 文件
                case 3: return 'fa-file-word'; // 文档
                case 4: return 'fa-file-excel'; // 表格
                case 5: return 'fa-file-alt'; // 收集表
                default: return 'fa-file';
            }
        }

        // 获取用户token（从博客系统获取）
        function getAuthToken() {
            // 这里假设博客系统将token存储在localStorage中
            // 实际使用时需要根据博客系统的实现进行调整
            return localStorage.getItem('auth_token') || sessionStorage.getItem('blog_token');
        }

        // 验证用户登录状态
        async function checkUserLogin() {
            try {
                const token = getAuthToken();
                if (!token) {
                    showLoginPrompt();
                    return false;
                }

                const response = await fetch(`${CONFIG.API_BASE}/user`, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                const data = await response.json();
                
                if (data.logged_in && data.user) {
                    user = data.user;
                    showUserInfo();
                    return true;
                } else {
                    showLoginPrompt();
                    return false;
                }
            } catch (error) {
                console.error('验证用户失败:', error);
                showLoginPrompt();
                return false;
            }
        }

        // 显示用户信息
        function showUserInfo() {
            userInfoEl.innerHTML = `
                <div class="avatar">
                    <img src="${user.avatar}" alt="${user.username}">
                </div>
                <div class="username">${user.username}</div>
            `;
        }

        // 显示登录提示
        function showLoginPrompt() {
            userInfoEl.innerHTML = `
                <div class="login-prompt">
                    <i class="fas fa-exclamation-triangle"></i>
                    请先登录博客系统
                </div>
            `;
            window.location.href = '/';
        }

        // 获取文件列表
        async function getFileList(folderId = CONFIG.SPACE_ID, sort = 1, start = 0) {
            try {
                loadingEl.style.display = 'block';
                emptyStateEl.style.display = 'none';
                fileListEl.innerHTML = '';

                const token = getAuthToken();
                const response = await fetch(`${CONFIG.API_BASE}/list`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        fatherid: folderId,
                        sort_type: sort,
                        start: start,
                        limit: 100
                    })
                });

                const data = await response.json();

                if (data.errcode === 0 && data.file_list && data.file_list.item) {
                    displayFileList(data.file_list.item);
                    updateBreadcrumb(folderId);
                    
                    if (data.file_list.item.length === 0) {
                        emptyStateEl.style.display = 'block';
                    }
                } else {
                    showError('获取文件列表失败: ' + (data.errmsg || '未知错误'));
                }
            } catch (error) {
                console.error('获取文件列表失败:', error);
                showError('网络错误，请稍后重试');
            } finally {
                loadingEl.style.display = 'none';
            }
        }

        // 显示文件列表
        function displayFileList(files) {
            fileListEl.innerHTML = '';

            files.forEach(file => {
                const isFolder = file.file_type === 1;
                const iconClass = getFileIcon(file.file_type);
                
                const fileItem = document.createElement('div');
                fileItem.className = 'file-item';
                fileItem.dataset.fileid = file.fileid;
                fileItem.dataset.type = file.file_type;
                fileItem.dataset.filename = file.file_name;
                fileItem.dataset.size = file.file_size;
                
                fileItem.innerHTML = `
                    <div class="file-icon ${isFolder ? 'folder' : ''}">
                        <i class="fas ${iconClass}"></i>
                    </div>
                    <div class="file-name">${file.file_name}</div>
                    <div class="file-meta">
                        <span class="file-size">
                            <i class="fas fa-hdd"></i>
                            ${isFolder ? '文件夹' : formatFileSize(file.file_size)}
                        </span>
                        <span class="file-date">
                            <i class="fas fa-calendar"></i>
                            ${formatTimestamp(file.mtime)}
                        </span>
                    </div>
                    ${!isFolder ? `
                    <div class="file-actions">
                        <button class="action-btn tooltip download-btn" title="下载文件">
                            <i class="fas fa-download"></i>
                        </button>
                    </div>
                    ` : ''}
                `;

                // 添加点击事件
                fileItem.addEventListener('click', (e) => {
                    if (!e.target.closest('.action-btn')) {
                        if (isFolder) {
                            currentFolderId = file.fileid;
                            getFileList(currentFolderId, currentSort);
                        }
                    }
                });

                // 添加下载按钮事件
                if (!isFolder) {
                    const downloadBtn = fileItem.querySelector('.download-btn');
                    downloadBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        downloadFile(file);
                    });
                }

                fileListEl.appendChild(fileItem);
            });
        }

        // 更新面包屑导航
        function updateBreadcrumb(folderId) {
            // 简化实现：只显示当前目录和根目录
            // 实际应用中可能需要获取完整的目录树
            breadcrumbEl.innerHTML = `
                <ol>
                    <li>
                        <a href="#" data-id="" class="breadcrumb-item">
                            <i class="fas fa-home"></i>
                            根目录
                        </a>
                    </li>
                    ${folderId !== CONFIG.SPACE_ID ? `
                    <li class="separator">/</li>
                    <li>
                        <a href="#" class="breadcrumb-item">
                            当前目录
                        </a>
                    </li>
                    ` : ''}
                </ol>
            `;

            // 添加面包屑点击事件
            const breadcrumbItems = breadcrumbEl.querySelectorAll('.breadcrumb-item');
            breadcrumbItems.forEach(item => {
                item.addEventListener('click', (e) => {
                    e.preventDefault();
                    const folderId = item.dataset.id || CONFIG.SPACE_ID;
                    currentFolderId = folderId;
                    getFileList(currentFolderId, currentSort);
                });
            });
        }

        // 下载文件
                // 下载文件
        async function downloadFile(file) {
            try {
                // 添加到下载队列
                addToDownloadQueue(file);
                
                const token = getAuthToken();
                const response = await fetch(`${CONFIG.API_BASE}/download`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        fileid: file.fileid
                    })
                });

                const data = await response.json();

                if (data.errcode === 0 && data.download_url) {
                    // 使用blob下载文件，同时传递cookie
                    await downloadWithBlob(data.download_url + '&authkey=' + data.cookie_value, file.file_name, null, null);
                    updateDownloadStatus(file.fileid, 'success');
                } else {
                    throw new Error(data.errmsg || '下载失败');
                }
            } catch (error) {
                console.error('下载文件失败:', error);
                updateDownloadStatus(file.fileid, 'error');
                showError('下载失败: ' + error.message);
            }
        }
               // 使用blob下载文件
        async function downloadWithBlob(url, filename, cookieName, cookieValue) {
            window.location.href = url;
        }

        // 添加到下载队列
        function addToDownloadQueue(file) {
            const downloadId = Date.now();
            const downloadItem = {
                id: downloadId,
                fileid: file.fileid,
                filename: file.file_name,
                status: 'pending',
                size: file.file_size,
                progress: 0
            };

            downloads.push(downloadItem);
            updateDownloadTray();
            showDownloadTray();
        }

        // 更新下载状态
        function updateDownloadStatus(fileid, status) {
            const download = downloads.find(d => d.fileid === fileid);
            if (download) {
                download.status = status;
                if (status === 'success') {
                    setTimeout(() => {
                        removeFromDownloadQueue(fileid);
                    }, 2000);
                }
                updateDownloadTray();
            }
        }

        // 从下载队列移除
        function removeFromDownloadQueue(fileid) {
            downloads = downloads.filter(d => d.fileid !== fileid);
            updateDownloadTray();
            if (downloads.length === 0) {
                hideDownloadTray();
            }
        }

        // 更新下载托盘
        function updateDownloadTray() {
            trayCountEl.textContent = downloads.length;
            trayContentEl.innerHTML = '';

            downloads.forEach(download => {
                const item = document.createElement('div');
                item.className = 'download-item';
                item.innerHTML = `
                    <div class="download-icon">
                        <i class="fas fa-file-download"></i>
                    </div>
                    <div class="download-info">
                        <div class="download-name">${download.filename}</div>
                        <div class="download-progress">
                            ${formatFileSize(download.size)}
                        </div>
                    </div>
                    <div class="download-status ${download.status}"></div>
                `;
                trayContentEl.appendChild(item);
            });
        }

        // 显示下载托盘
        function showDownloadTray() {
            downloadTrayEl.style.display = 'block';
        }

        // 隐藏下载托盘
        function hideDownloadTray() {
            downloadTrayEl.style.display = 'none';
        }

        // 显示错误信息
        function showError(message) {
            alert(message); // 实际应用中可以使用更优雅的提示方式
        }

        // 初始化排序按钮
        function initSortButtons() {
            const sortButtons = document.querySelectorAll('.sort-btn');
            sortButtons.forEach(button => {
                button.addEventListener('click', () => {
                    sortButtons.forEach(btn => btn.classList.remove('active'));
                    button.classList.add('active');
                    currentSort = parseInt(button.dataset.sort);
                    getFileList(currentFolderId, currentSort);
                });
            });
        }

        // 初始化下载托盘交互
        function initDownloadTray() {
            let trayCollapsed = false;
            
            trayToggleEl.addEventListener('click', () => {
                trayCollapsed = !trayCollapsed;
                trayContentEl.style.display = trayCollapsed ? 'none' : 'block';
                trayToggleEl.innerHTML = trayCollapsed ? 
                    '<i class="fas fa-chevron-up"></i>' : 
                    '<i class="fas fa-chevron-down"></i>';
            });

            trayHeaderEl.addEventListener('click', (e) => {
                if (e.target !== trayToggleEl && !trayToggleEl.contains(e.target)) {
                    trayCollapsed = !trayCollapsed;
                    trayContentEl.style.display = trayCollapsed ? 'none' : 'block';
                    trayToggleEl.innerHTML = trayCollapsed ? 
                        '<i class="fas fa-chevron-up"></i>' : 
                        '<i class="fas fa-chevron-down"></i>';
                }
            });
        }

        // 初始化
        async function init() {
            initSortButtons();
            initDownloadTray();
            
            // 检查用户登录状态
            const isLoggedIn = await checkUserLogin();
            
            if (isLoggedIn) {
                // 获取文件列表
                await getFileList(currentFolderId, currentSort);
            }
        }

        // 页面加载完成后初始化
        document.addEventListener('DOMContentLoaded', init);