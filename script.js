
(function () {
    "use strict";
    const base = new URL("./", document.currentScript.src);
    const titles = ["回头", "那天傍晚", "熟悉", "一起犯傻", "咔哒", "她记得", "靠近", "湘湖", "那些小事", "后来"];
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const reader = document.getElementById("reader");
    const directory = document.getElementById("directory");
    const controls = document.getElementById("storyControls");
    const previous = document.getElementById("previousPanelButton");
    const next = document.getElementById("nextPanelButton");
    const errorBox = document.getElementById("readerError");
    const payloads = new Map(), pending = new Map();
    let records = new Map(), current = null, startChapter = 1, phase = "loading";
    let busy = false, generation = 0, timers = [], retryAction = null, directoryScroll = 0, ending = null;

    // 逐章加载，同时兼容静态托管与直接双击本地 HTML。
    window.registerComicChapter = data => payloads.set(data.number, data);
    function loadChapter(number) {
        if (payloads.has(number)) return Promise.resolve(payloads.get(number));
        if (pending.has(number)) return pending.get(number);
        const promise = new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = new URL(`chapter${number}/content.js`, base).href;
            script.onload = () => {
                script.remove();
                if (payloads.has(number)) resolve(payloads.get(number));
                else reject(new Error("章节内容不完整"));
            };
            script.onerror = () => { script.remove(); reject(new Error("章节加载失败")); };
            document.head.appendChild(script);
        }).finally(() => pending.delete(number));
        pending.set(number, promise);
        return promise;
    }
    function later(callback, delay) {
        const token = generation;
        timers.push(setTimeout(() => { if (token === generation) callback(); }, delay));
    }
    function clearTimers() {
        generation++;
        timers.forEach(clearTimeout);
        timers = [];
        busy = false;
    }
    function syncControls() {
        const video = current?.stage?.querySelector("video");
        const waitingForVideo = video && current.index === current.panels.length - 1 && !current.videoFinished;
        previous.disabled = busy || !current || (current.number === startChapter && current.index === 0 && phase === "panel");
        next.disabled = busy || phase === "ending" || Boolean(waitingForVideo);
        reader.dataset.chapter = current ? String(current.number) : "";
        reader.dataset.phase = phase;
        reader.dataset.panel = current ? String(current.index) : "";
    }
    function fail(error, retry) {
        busy = false;
        errorBox.querySelector("span").textContent = "这一章暂时未能加载，请重试。";
        errorBox.hidden = false;
        retryAction = retry;
        console.error(error);
        syncControls();
    }
    function makeRecord(number, withHeading) {
        const section = document.createElement("section");
        section.className = "chapter";
        section.dataset.chapter = number;
        section.setAttribute("aria-label", `第${number}章 ${titles[number - 1]}`);
        let heading = null;
        if (withHeading) {
            heading = document.createElement("h2");
            heading.className = "chapter-transition";
            heading.textContent = titles[number - 1];
            section.appendChild(heading);
        }
        reader.appendChild(section);
        const record = { number, section, heading, host: null, stage: null, panels: [], index: -1, videoFinished: false };
        records.set(number, record);
        return record;
    }

    // 保留各章原画布比例，仅让外层高度跟随已显示分镜，避免章末多余空白。
    function fitHeight(record) {
        if (!record.host || record.host.hidden || record.section.hidden || reader.hidden) return;
        const canvas = record.stage.querySelector(".comic-canvas");
        const top = canvas.getBoundingClientRect().top - record.host.getBoundingClientRect().top;
        const bottom = Math.max(0, ...record.panels.filter(panel => panel.classList.contains("visible"))
            .map(panel => panel.offsetTop + panel.offsetHeight));
        record.host.style.height = Math.ceil(top + bottom + 10) + "px";
    }
    function scrollToElement(element, force = false) {
        if (!element || !directory.hidden) return;
        const rect = element.getBoundingClientRect();
        if (force || rect.bottom > innerHeight * 0.88 || rect.top < 0) {
            window.scrollTo({ top: Math.max(0, scrollY + rect.top - innerHeight * 0.23), behavior: reduced ? "auto" : "smooth" });
        }
    }
    function setDetails(panel, visible) {
        panel.querySelectorAll(".delayed-element").forEach(element => element.classList.toggle("show-detail", visible));
    }
    function scheduleDetails(record, schedule = [], minimumDelay = 200) {
        busy = true;
        schedule.forEach(([selector, delay]) => {
            const show = () => record.stage.querySelector(selector)?.classList.add("show-detail");
            if (delay === 0 || reduced) show();
            else later(show, delay);
        });
        const lastDelay = Math.max(minimumDelay, ...schedule.map(item => item[1]));
        later(() => { busy = false; syncControls(); }, reduced ? 0 : lastDelay);
        syncControls();
    }
    async function mount(record) {
        if (record.host) { record.host.hidden = false; return; }
        const token = generation;
        const data = await loadChapter(record.number);
        if (token !== generation) return;
        const chapterBase = new URL(`chapter${record.number}/`, base);
        const host = document.createElement("manga-stage");
        const shadow = host.attachShadow({ mode: "open" });
        const template = document.createElement("template");
        template.innerHTML = data.html;
        template.content.querySelectorAll("[src], [poster]").forEach(element => {
            for (const attr of ["src", "poster"]) {
                if (element.hasAttribute(attr)) element.setAttribute(attr, new URL(element.getAttribute(attr), chapterBase).href);
            }
        });
        const stylesheet = document.createElement("link");
        stylesheet.rel = "stylesheet";
        stylesheet.href = new URL("style.css", chapterBase).href;
        const ready = new Promise((resolve, reject) => {
            stylesheet.onload = resolve;
            stylesheet.onerror = () => reject(new Error("章节样式加载失败"));
        });
        shadow.appendChild(stylesheet);
        shadow.appendChild(template.content);
        const continuityStyle = document.createElement("style");
        continuityStyle.textContent = ":host{--paper:#fff;--ink:#111;--panel-border:2px;display:block;overflow:hidden;position:relative;} .comic-page{box-shadow:none;} .panel:not(.visible) .delayed-element{visibility:hidden;}";
        shadow.appendChild(continuityStyle);
        host.style.visibility = "hidden";
        record.section.appendChild(host);
        try { await ready; } catch (error) { host.remove(); throw error; }
        if (token !== generation) { host.remove(); return; }
        record.host = host;
        record.stage = shadow;
        record.config = data;
        record.panels = data.panelOrder ? data.panelOrder.map(selector => shadow.querySelector(selector)) : [...shadow.querySelectorAll(".panel")];
        record.panels.forEach(panel => { panel.classList.remove("visible"); setDetails(panel, false); });
        fitHeight(record);
        host.style.visibility = "";
        attachVideo(record);
    }
    function attachVideo(record) {
        const video = record.stage.querySelector("video");
        const button = record.stage.querySelector(".video-button");
        if (!video || !button) return;
        const panel = video.closest(".video-panel");
        button.addEventListener("click", event => {
            event.stopPropagation();
            video.play().catch(() => button.setAttribute("aria-label", "重新播放视频"));
        });
        video.addEventListener("play", () => panel.classList.add("has-started"));
        video.addEventListener("ended", () => {
            record.videoFinished = true;
            if (current === record && current.index === record.panels.length - 1 && phase === "panel") showEnding();
            syncControls();
        });
    }
    function revealPanel(record, index, scroll = true) {
        record.index = index;
        phase = "panel";
        const panel = record.panels[index];
        panel.classList.add("visible");
        panel.querySelector("video")?.setAttribute("preload", "metadata");
        fitHeight(record);
        scheduleDetails(record, record.config.details[index]);
        if (scroll) later(() => scrollToElement(panel), reduced ? 0 : 100);
    }
    async function enterChapter(record, scroll = true) {
        const token = generation;
        busy = true;
        syncControls();
        try {
            await mount(record);
            if (token !== generation) return;
            errorBox.hidden = true;
            revealPanel(record, 0, scroll);
        } catch (error) {
            if (token === generation) fail(error, () => enterChapter(record, scroll));
        }
    }
    function clickSteps() { return current.config.clickSteps?.[current.index] || []; }
    function showEnding() {
        if (!ending) {
            ending = document.createElement("footer");
            ending.className = "story-ending";
            ending.textContent = "完";
            ending.setAttribute("aria-label", "漫画结束");
            reader.appendChild(ending);
        }
        ending.hidden = false;
        phase = "ending";
        scrollToElement(ending);
        syncControls();
    }
    function advance() {
        if (busy || !directory.hidden || !current || phase === "ending" || phase === "loading") return;
        if (phase === "transition") { enterChapter(current); return; }
        const step = clickSteps().find(step => !current.stage.querySelector(step[0][0]).classList.contains("show-detail"));
        if (step) { scheduleDetails(current, step, step[step.length - 1][1] + 550); return; }
        if (current.index < current.panels.length - 1) { revealPanel(current, current.index + 1); return; }
        if (current.number === 10) { if (current.videoFinished) showEnding(); return; }
        const number = current.number + 1;
        current = records.get(number) || makeRecord(number, true);
        current.section.hidden = false;
        current.index = -1;
        if (current.host) current.host.hidden = true;
        phase = "transition";
        document.title = titles[number - 1];
        scrollToElement(current.heading);
        busy = true;
        later(() => { busy = false; syncControls(); }, reduced ? 0 : 200);
        syncControls();
    }
    function goBack() {
        if (busy || !directory.hidden || !current) return;
        if (phase === "ending") {
            ending.hidden = true; phase = "panel";
            scrollToElement(current.panels[current.index], true); syncControls(); return;
        }
        if (phase === "transition") {
            current.section.hidden = true;
            current = records.get(current.number - 1);
            phase = "panel";
            scrollToElement(current.panels[current.index], true);
        } else if (phase === "panel") {
            const step = clickSteps().slice().reverse().find(step => current.stage.querySelector(step[0][0]).classList.contains("show-detail"));
            if (step) {
                step.forEach(item => current.stage.querySelector(item[0]).classList.remove("show-detail"));
            } else if (current.index > 0) {
                const panel = current.panels[current.index];
                panel.querySelector("video")?.pause();
                panel.classList.remove("visible");
                setDetails(panel, false);
                current.index--;
                fitHeight(current);
                scrollToElement(current.panels[current.index], true);
            } else if (current.number > startChapter) {
                current.panels[0].classList.remove("visible");
                setDetails(current.panels[0], false);
                current.host.hidden = true;
                current.index = -1;
                phase = "transition";
                scrollToElement(current.heading, true);
            }
        }
        syncControls();
    }
    async function start(number) {
        clearTimers();
        records.forEach(record => record.stage?.querySelector("video")?.pause());
        reader.replaceChildren(); records = new Map(); ending = null;
        startChapter = Math.max(1, Math.min(10, number || 1));
        current = makeRecord(startChapter, false);
        phase = "loading"; errorBox.hidden = true;
        document.title = titles[startChapter - 1];
        window.scrollTo({ top: 0, behavior: "auto" });
        await enterChapter(current, false);
    }
    function openDirectory(push = true) {
        if (!directory.hidden) return;
        directoryScroll = scrollY;
        records.forEach(record => record.stage?.querySelector("video")?.pause());
        directory.hidden = false; reader.hidden = true; controls.hidden = true; errorBox.hidden = true;
        window.scrollTo({ top: 0, behavior: "auto" });
        if (push) history.pushState(null, "", "#directory");
    }
    function closeDirectory() {
        directory.hidden = true; reader.hidden = false; controls.hidden = false;
        records.forEach(fitHeight);
        window.scrollTo({ top: directoryScroll, behavior: "auto" });
        if (!current) start(startChapter);
        syncControls();
    }
    document.getElementById("directoryLink").addEventListener("click", event => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); openDirectory();
    });
    document.getElementById("resumeReading").addEventListener("click", () => {
        history.replaceState(null, "", `#chapter-${startChapter}`); closeDirectory();
    });
    directory.querySelectorAll("[data-chapter]").forEach(link => link.addEventListener("click", event => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        const number = Number(link.dataset.chapter);
        history.replaceState(null, "", `#chapter-${number}`);
        directory.hidden = true; reader.hidden = false; controls.hidden = false;
        start(number);
    }));
    window.addEventListener("popstate", () => {
        if (location.hash === "#directory") openDirectory(false);
        else closeDirectory();
    });
    document.getElementById("retryLoad").addEventListener("click", () => { errorBox.hidden = true; retryAction?.(); });
    previous.addEventListener("click", goBack);
    next.addEventListener("click", advance);
    function isControl(event) {
        return event.composedPath().some(target => target instanceof Element && target.matches("a, button, video, input, .video-panel, #directory, #readerError"));
    }
    let pointer = null, multiTouch = false;
    const touches = new Set();
    document.addEventListener("pointerdown", event => {
        if (event.pointerType === "touch") {
            touches.add(event.pointerId);
            if (touches.size > 1) { multiTouch = true; pointer = null; return; }
        }
        if (!event.isPrimary || event.button !== 0 || isControl(event)) return;
        pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now() };
    }, { passive: true });
    document.addEventListener("pointerup", event => {
        const ignored = multiTouch;
        touches.delete(event.pointerId);
        if (!touches.size) multiTouch = false;
        const start = pointer; pointer = null;
        if (ignored || !start || start.id !== event.pointerId || isControl(event)) return;
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 14 && performance.now() - start.time < 500) advance();
    }, { passive: true });
    document.addEventListener("pointercancel", event => {
        touches.delete(event.pointerId); if (!touches.size) multiTouch = false; pointer = null;
    }, { passive: true });
    document.addEventListener("keydown", event => {
        if (isControl(event) || !directory.hidden) return;
        if (event.code === "ArrowLeft") { event.preventDefault(); goBack(); }
        else if (["Space", "Enter", "ArrowRight", "ArrowDown"].includes(event.code)) { event.preventDefault(); advance(); }
    });
    window.addEventListener("resize", () => records.forEach(fitHeight));
    window.addEventListener("pagehide", () => records.forEach(record => record.stage?.querySelector("video")?.pause()));
    const requested = Number(location.hash.match(/^#chapter-(\d+)$/)?.[1] || new URLSearchParams(location.search).get("chapter") || document.body.dataset.startChapter || 1);
    startChapter = Math.max(1, Math.min(10, requested || 1));
    if (location.hash === "#directory" || (document.body.dataset.directory && !location.hash.startsWith("#chapter-"))) openDirectory(false);
    else start(startChapter);
}());
