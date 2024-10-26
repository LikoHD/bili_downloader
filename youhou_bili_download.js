// ==UserScript==
// @name         哔哩哔哩视频下载按钮
// @namespace    http://tampermonkey.net/
// @version      0.4
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
        const bvid = window.location.href.match(/BV\w+/)?.[0];
        
        if (!bvid) {
            throw new Error('无法从当前页面URL中获取BV号，请确保在B站视频页面使用');
        }
        
        const initialState = window.__INITIAL_STATE__;
        const videoData = initialState?.videoData;
        
        if (!videoData) {
            return {
                bvid: bvid,
                aid: null,
                cid: null
            };
        }
    
        return {
            bvid: videoData.bvid,
            title: videoData.title,
            pic: videoData.pic,
            aid: videoData.aid,
            cid: videoData.cid || videoData.pages?.[0]?.cid
        };
    }

    // 使用bilibili官方接口解析视频
    async function getVideoUrl(aid, cid, quality) {
        const apiUrl = 'https://api.bilibili.com/x/player/playurl';
        const params = {
            otype: 'json',
            platform: 'html5',
            avid: aid,
            cid: cid,
            qn: quality,
            fnver: 0,
            fnval: 1,
            high_quality: 1
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
    async function parseVideoUrl(bvid, apiIndex = 0) {
        if (apiIndex >= PARSE_APIS.length) {
            throw new Error('所有解析接口都失败了');
        }
    
        try {
            const apiUrl = `${PARSE_APIS[apiIndex]}?bv=${bvid}`;
            
            const response = await fetch(apiUrl);
            const data = await response.json();
            
            if (!data.url && !data.data?.url) {
                throw new Error('解析接口返回数据格式错误');
            }
    
            return data.url || data.data.url;
        } catch (error) {
            return parseVideoUrl(bvid, apiIndex + 1);
        }
    }

    // 构造下载信息
    async function constructDownloadInfo() {
        try {
            const videoInfo = getBiliVideoInfo();
            
            let downloadUrl;
            try {
                if (videoInfo.aid && videoInfo.cid) {
                    downloadUrl = await getVideoUrl(videoInfo.aid, videoInfo.cid, 80);
                }
            } catch (error) {
                // 官方API失败时静默切换到备用接口
            }

            if (!downloadUrl) {
                downloadUrl = await parseVideoUrl(videoInfo.bvid);
            }
            
            return {
                bvid: videoInfo.bvid,
                downloadUrl: downloadUrl,
                title: videoInfo.title
            };
            
        } catch (error) {
            throw error;
        }
    }

    // 开始下载
    async function startDownload() {
        try {
            const downloadInfo = await constructDownloadInfo();
            const downloadWindow = window.open(downloadInfo.downloadUrl, '_blank');
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
