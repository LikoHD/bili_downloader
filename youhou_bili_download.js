// ==UserScript==
// @name         bilibili哔哩哔哩视频下载按钮
// @namespace    http://tampermonkey.net/
// @version      0.5
// @description  在哔哩哔哩视频页面添加下载按钮
// @match        https://www.bilibili.com/video/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // 定义一些常用的解析接口
    const PARSE_APIS = [
        'https://api.injahow.cn/bparse/',
        'https://jx.jsonplayer.com/player/',
        'https://jx.bozrc.com:4433/player/',
        'https://jx.parwix.com:4433/player/'
    ];

    function createDownloadButton() {
        const downloadBtn = document.createElement('button');
        downloadBtn.textContent = '下载';
        downloadBtn.style.cssText = `
            margin-left: 10px;
            padding: 5px 12px;
            background: #00aeec;
            color: white;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 13px;
            height: 32px;
            line-height: 18px;
            min-width: 50px;
        `;
        downloadBtn.onclick = startDownload;
        return downloadBtn;
    }

    // 获取视频基本信息
    function getBiliVideoInfo() {
        try {
            // 首先尝试从 window.__INITIAL_STATE__ 获取视频信息
            let initialState = window.__INITIAL_STATE__;
            let videoData = initialState?.videoData;
            
            // 如果上面的方式失败，尝试从其他可能的数据源获取
            if (!videoData) {
                // 尝试从 window.__playinfo__ 获取
                const playInfo = window.__playinfo__;
                if (playInfo) {
                    videoData = {
                        bvid: document.querySelector('meta[itemprop="url"]')?.content?.split('/').pop(),
                        aid: playInfo.aid,
                        cid: playInfo.cid,
                        title: document.querySelector('h1.video-title')?.textContent?.trim(),
                        desc: document.querySelector('.desc-info-text')?.textContent?.trim(),
                        pic: document.querySelector('meta[itemprop="image"]')?.content,
                        owner: {
                            name: document.querySelector('.up-name')?.textContent?.trim(),
                            face: document.querySelector('.up-avatar img')?.src,
                            mid: document.querySelector('.up-name')?.href?.match(/\d+/)?.[0]
                        }
                    };
                }
            }
    
            // 如果还是没有数据，尝试从URL和页面元素获取
            if (!videoData) {
                const bvid = location.pathname.match(/BV\w+/)?.[0];
                videoData = {
                    bvid: bvid,
                    title: document.title.replace(' - 哔哩哔哩', '').trim(),
                    pic: document.querySelector('meta[property="og:image"]')?.content,
                    desc: document.querySelector('meta[property="og:description"]')?.content,
                    owner: {
                        name: document.querySelector('.up-name')?.textContent?.trim(),
                        face: document.querySelector('.up-avatar img')?.src,
                        mid: document.querySelector('.up-name')?.href?.match(/\d+/)?.[0]
                    }
                };
            }
            
            if (!videoData || !videoData.bvid) {
                throw new Error('无法获取视频信息');
            }
    
            // 确保返回的对象包含所有必要的字段
            return {
                bvid: videoData.bvid,
                pic: videoData.pic || '',
                title: videoData.title || document.title,
                pubdate: videoData.pubdate,
                desc: videoData.desc || '',
                duration: videoData.duration,
                owner: {
                    mid: videoData.owner?.mid || '',
                    name: videoData.owner?.name || '未知用户',
                    face: videoData.owner?.face || ''
                },
                aid: videoData.aid,
                cid: videoData.cid || videoData.pages?.[0]?.cid
            };
        } catch (error) {
            console.error('获取视频信息失败:', error);
            // 添加更详细的错误信息
            console.log('当前页面URL:', location.href);
            console.log('window.__INITIAL_STATE__:', window.__INITIAL_STATE__);
            console.log('window.__playinfo__:', window.__playinfo__);
            throw error;
        }
    }
    

    // 使用bilibili官方接口解析视频
    async function getVideoUrl(aid, cid, quality) {
        const apiUrl = 'https://api.bilibili.com/x/player/playurl';
        const params = {
            otype: 'json',
            platform: 'html5',
            avid: aid,
            cid: cid,
            qn: quality || window.__playinfo__?.data?.accept_quality?.[0] || 80,
            fnver: 0,
            fnval: 4048,
            high_quality: window.__playinfo__?.data?.quality || 1
        };
        
        const queryString = Object.entries(params)
            .map(([key, value]) => `${key}=${value}`)
            .join('&');
        
        const response = await fetch(`${apiUrl}?${queryString}`, {
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.code !== 0) {
            throw new Error(data.message || '获取下载地址失败');
        }
        
        return data.data.durl[0].url;
    }

    // 使用第三方接口解析视频
    async function parseVideoUrl(bvid, apiIndex = 0, usedQuality = null) {
        if (apiIndex >= PARSE_APIS.length) {
            throw new Error('所有解析接口都失败了');
        }
    
        try {
            // 如果没有传入清晰度，使用当前播放器的清晰度设置
            const quality = usedQuality || window.__playinfo__?.data?.quality || 80;
            
            // 构建API URL，添加清晰度参数
            const apiUrl = `${PARSE_APIS[apiIndex]}?bv=${bvid}&q=${quality}`;
            
            console.log(`尝试解析接口${apiIndex + 1}，清晰度: ${quality}`);
            
            const response = await fetch(apiUrl);
            const data = await response.json();
            
            if (!data.url && !data.data?.url) {
                // 如果当前清晰度失败且不是1080P，尝试降级到1080P
                if (quality !== 80) {
                    console.log(`清晰度${quality}解析失败，尝试1080P`);
                    return parseVideoUrl(bvid, apiIndex, 80);
                }
                throw new Error('解析接口返回数据格式错误');
            }
    
            return {
                url: data.url || data.data.url,
                quality: quality
            };
        } catch (error) {
            return parseVideoUrl(bvid, apiIndex + 1, usedQuality);
        }
    }

    // 构造下载信息
    async function constructDownloadInfo() {
        try {
            const videoInfo = getBiliVideoInfo();
            
            let downloadUrl;
            let usedQuality;  // 添加变量记录使用的清晰度
            
            try {
                if (videoInfo.aid && videoInfo.cid) {
                    const quality = window.__playinfo__?.data?.accept_quality?.[0] || 80;
                    downloadUrl = await getVideoUrl(videoInfo.aid, videoInfo.cid, quality);
                    usedQuality = quality;  // 记录官方API使用的清晰度
                }
            } catch (error) {
                // 官方API失败时静默切换到备用接口
            }

            if (!downloadUrl) {
                const result = await parseVideoUrl(videoInfo.bvid, 0, window.__playinfo__?.data?.quality);
                downloadUrl = result.url;
                usedQuality = result.quality;
            }
            
            return {
                bvid: videoInfo.bvid,
                downloadUrl: downloadUrl,
                title: videoInfo.title,
                desc: videoInfo.desc,
                pic: videoInfo.pic,
                aid: videoInfo.aid,
                cid: videoInfo.cid,
                owner: videoInfo.owner,
                face: videoInfo.face,
                downloadUrl,
                usedQuality,  // 将清晰度信息添加到返回对象中
            };
        } catch (error) {
            throw error;
        }
    }

    // 开始下载
    async function startDownload() {
        try {
            const downloadInfo = await constructDownloadInfo();
            
            // 在控制台打印下载信息
            console.group('视频下载信息');
            console.log('标题:', downloadInfo.title);
            console.log('描述:', downloadInfo.desc);
            console.log('封面:', downloadInfo.pic);
            console.log('下载地址:', downloadInfo.downloadUrl);
            console.log('UP主:', downloadInfo.owner?.name);
            console.log('UP主头像:', downloadInfo.owner?.face);
            console.log('BV号:', downloadInfo.bvid);
            console.log('AV号:', downloadInfo.aid);
            console.log('CID:', downloadInfo.cid);
            
            // 添加清晰度相关信息
            console.group('清晰度信息');
            console.log('支持的清晰度列表:', window.__playinfo__?.data?.accept_quality?.map(qn => ({
                qn,
                desc: {
                    120: '4K',
                    116: '1080P60帧',
                    112: '1080P+高码率',
                    80: '1080P',
                    64: '720P',
                    32: '480P',
                    16: '360P'
                }[qn] || `未知(${qn})`
            })));
            console.log('当前播放清晰度:', window.__playinfo__?.data?.quality);
            
            if (downloadInfo.isOfficialApi) {
                console.log('下载使用的清晰度:', `${downloadInfo.usedQuality} (${
                    {
                        120: '4K',
                        116: '1080P60帧',
                        112: '1080P+高码率',
                        80: '1080P',
                        64: '720P',
                        32: '480P',
                        16: '360P'
                    }[downloadInfo.usedQuality] || '未知清晰度'
                })`);
                console.log('使用接口: 官方API');
            } else {
                console.log('下载使用的清晰度:', `${downloadInfo.usedQuality} (${
                    {
                        120: '4K',
                        116: '1080P60帧',
                        112: '1080P+高码率',
                        80: '1080P',
                        64: '720P',
                        32: '480P',
                        16: '360P'
                    }[downloadInfo.usedQuality] || '未知清晰度'
                })`);
                console.log('使用接口: 第三方接口');
                console.log('提示: 如需更高清晰度，建议登录后使用官方API下载');
            }
            console.groupEnd();
            
            console.groupEnd();
            
            // 构建URL参数
            const params = new URLSearchParams();
            params.append('title', downloadInfo.title || '');
            params.append('desc', downloadInfo.desc || '');
            params.append('pic', downloadInfo.pic || '');
            params.append('downloadUrl', downloadInfo.downloadUrl);
            params.append('owner', downloadInfo.owner?.name || '');
            params.append('face', downloadInfo.owner?.face || '');
            
            // 构建完整的URL地址
            const baseUrl = 'https://saveany.cn/get_video_info.html';
            const finalUrl = `${baseUrl}?${params.toString()}`;
            
            // 在控制台打印最终URL
            console.log('最终请求URL:', finalUrl);
            
            // 打开新窗口
            const downloadWindow = window.open(finalUrl, '_blank');
            if (downloadWindow) {
                downloadWindow.focus();
            } else {
                alert('下载窗口被浏览器阻止，请允许弹出窗口后重试。');
            }
        } catch (error) {
            console.error('下载失败:', error);
            alert('下载失败: ' + error.message);
        }
    }


    
    function addDownloadButton() {
        const targetArea = document.querySelector("#bilibili-player > div > div > div.bpx-player-primary-area > div.bpx-player-sending-area > div");

        if (targetArea && !targetArea.querySelector('.download-btn')) {
            const downloadBtn = createDownloadButton();
            downloadBtn.classList.add('download-btn');
            targetArea.appendChild(downloadBtn);
        }
    }

    function observeDOM() {
        const targetNode = document.body;
        const config = { childList: true, subtree: true };
        const observer = new MutationObserver((mutationsList, observer) => {
            for(let mutation of mutationsList) {
                if (mutation.type === 'childList') {
                    addDownloadButton();
                }
            }
        });
        observer.observe(targetNode, config);
    }

    // 初始尝试添加按钮
    window.addEventListener('load', () => {
        addDownloadButton();
        observeDOM();
    });

    // 定期检查并尝试重新添加按钮
    setInterval(addDownloadButton, 5000);
})();
