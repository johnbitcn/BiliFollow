// ==UserScript==
// @name         B 站关注管理器
// @namespace    https://github.com/johnbitcn/BiliFavUI
// @license      MIT
// @version      0.3.4
// @description  在自己的关注页批量管理分组、特别关注、取消关注和黑名单
// @match        https://space.bilibili.com/*/relation/follow*
// @grant        GM_xmlhttpRequest
// @connect      api.bilibili.com
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const ROOT_ID = 'bfm-root';
  const PAGE_SIZE = 50;
  const PAUSE_MS = 3000;
  const LOAD_PAUSE_MS = 1200;
  const pageMid = location.pathname.match(/^\/(\d+)\/relation\/follow/);
  const cookie = name => document.cookie.split('; ').find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
  const ownMid = cookie('DedeUserID');
  if (!pageMid || !ownMid || pageMid[1] !== ownMid || document.getElementById(ROOT_ID)) return;

  const state = {
    people: [], groups: [], selected: new Set(), groupFilters: new Set(), query: '', loaded: false,
    loading: false, running: false, stopping: false, partial: false,
    total: 0, done: 0, error: '', message: '', open: false,
    operation: 'unfollow', groupId: '', groupError: '',
  };
  const OPERATIONS = {
    unfollow: { label: '取消关注', verb: '取消关注', destructive: true },
    groupAdd: { label: '加入分组（保留原分组）', verb: '加入分组' },
    groupMove: { label: '移至分组（替换原分组）', verb: '移至分组' },
    specialAdd: { label: '设为特别关注', verb: '设为特别关注' },
    specialRemove: { label: '取消特别关注', verb: '取消特别关注' },
    block: { label: '加入黑名单', verb: '加入黑名单', destructive: true },
  };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);

  function request(method, path, data) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url: `https://api.bilibili.com${path}`,
        data: data?.toString(),
        headers: data ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined,
        withCredentials: true,
        timeout: 15000,
        onload(response) {
          if (response.status !== 200) return reject(new Error(`HTTP ${response.status}`));
          try {
            const result = JSON.parse(response.responseText);
            if (result.code === -352) throw new Error('B 站拦截了请求（-352）；请暂停操作，稍后再试');
            if (result.code !== 0) throw new Error(`${result.message || '接口错误'}（${result.code}）`);
            resolve(result.data);
          } catch (error) { reject(error); }
        },
        onerror: () => reject(new Error('网络请求失败')),
        ontimeout: () => reject(new Error('请求超时')),
      });
    });
  }

  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.innerHTML = `
    <style>
      #${ROOT_ID} { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; color: #1f2937; }
      #${ROOT_ID} * { box-sizing: border-box; }
      #${ROOT_ID} .bfm-launch { position: fixed; right: 24px; bottom: 24px; z-index: 2147483645; border: 0; border-radius: 999px; padding: 13px 19px; background: #00a1d6; color: white; font-size: 14px; font-weight: 700; box-shadow: 0 7px 24px #263b5c35; cursor: pointer; }
      #${ROOT_ID} .bfm-shade { position: fixed; inset: 0; z-index: 2147483646; background: #17212b99; display: none; align-items: center; justify-content: center; padding: 20px; }
      #${ROOT_ID}.bfm-open .bfm-shade { display: flex; }
      #${ROOT_ID} .bfm-panel { width: min(1100px, 100%); height: min(760px, 100%); display: flex; flex-direction: column; background: #f6f8fb; border-radius: 18px; overflow: hidden; box-shadow: 0 20px 70px #13263d55; }
      #${ROOT_ID} .bfm-header { display: flex; align-items: center; gap: 12px; padding: 20px 24px; background: white; border-bottom: 1px solid #e5eaf0; }
      #${ROOT_ID} h2 { margin: 0; font-size: 22px; line-height: 1.3; }
      #${ROOT_ID} .bfm-subtitle { color: #6b7280; font-size: 13px; margin-top: 4px; }
      #${ROOT_ID} .bfm-close { margin-left: auto; }
      #${ROOT_ID} button { cursor: pointer; font: inherit; }
      #${ROOT_ID} button:disabled { cursor: not-allowed; opacity: .5; }
      #${ROOT_ID} .bfm-text-button { border: 0; background: transparent; color: #536171; padding: 7px 9px; }
      #${ROOT_ID} .bfm-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding: 15px 24px; background: white; }
      #${ROOT_ID} .bfm-search { flex: 1 1 240px; min-width: 180px; border: 1px solid #d8e0e8; border-radius: 9px; padding: 10px 12px; outline-color: #00a1d6; font: inherit; }
      #${ROOT_ID} .bfm-select { min-width: 150px; max-width: 100%; border: 1px solid #d8e0e8; border-radius: 9px; background: white; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Cpath d='m4 6 4 4 4-4' fill='none' stroke='%23536171' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; background-size: 16px 16px; padding: 9px 36px 9px 12px; font: inherit; appearance: none; -webkit-appearance: none; cursor: pointer; }
      #${ROOT_ID} .bfm-filters { display: flex; flex-wrap: wrap; gap: 7px; max-height: 104px; overflow: auto; padding: 0 24px 13px; background: white; }
      #${ROOT_ID} .bfm-filter-heading { padding: 0 24px 8px; background: white; color: #748092; font-size: 12px; }
      #${ROOT_ID} .bfm-filter { border: 1px solid #d8e0e8; border-radius: 999px; background: white; color: #536171; padding: 5px 11px; font-size: 12px; }
      #${ROOT_ID} .bfm-filter[aria-pressed="true"] { color: #0078a6; background: #eaf8fd; border-color: #72c7e3; font-weight: 700; }
      #${ROOT_ID} .bfm-secondary { border: 1px solid #d8e0e8; border-radius: 9px; background: white; color: #354558; padding: 9px 13px; }
      #${ROOT_ID} .bfm-status { padding: 0 24px 13px; background: white; font-size: 13px; color: #657181; min-height: 30px; }
      #${ROOT_ID} .bfm-status.bfm-error { color: #b42318; }
      #${ROOT_ID} .bfm-list { flex: 1; overflow: auto; padding: 17px 24px; display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); align-content: start; gap: 12px; }
      #${ROOT_ID} .bfm-card { display: flex; gap: 12px; align-items: flex-start; min-width: 0; padding: 14px; border: 1px solid #e4eaf0; border-radius: 12px; background: white; cursor: pointer; }
      #${ROOT_ID} .bfm-card:has(input:checked) { border-color: #00a1d6; background: #effaff; }
      #${ROOT_ID} .bfm-card input { margin-top: 18px; accent-color: #00a1d6; }
      #${ROOT_ID} .bfm-avatar { width: 44px; height: 44px; border-radius: 50%; object-fit: cover; background: #e8edf2; flex: none; }
      #${ROOT_ID} .bfm-person { min-width: 0; }
      #${ROOT_ID} .bfm-name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 650; color: #223044; }
      #${ROOT_ID} .bfm-meta, #${ROOT_ID} .bfm-sign { color: #738091; font-size: 12px; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #${ROOT_ID} .bfm-groups { color: #0078a6; font-size: 12px; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #${ROOT_ID} .bfm-empty { grid-column: 1 / -1; text-align: center; color: #748092; padding: 60px 16px; }
      #${ROOT_ID} .bfm-footer { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 15px 24px; border-top: 1px solid #e5eaf0; background: white; }
      #${ROOT_ID} .bfm-selected { font-weight: 650; margin-right: auto; }
      #${ROOT_ID} .bfm-danger { border: 0; border-radius: 9px; background: #dc3545; color: white; padding: 10px 16px; font-weight: 700; }
      #${ROOT_ID} .bfm-primary { border: 0; border-radius: 9px; background: #00a1d6; color: white; padding: 10px 16px; font-weight: 700; }
      #${ROOT_ID} .bfm-confirm-shade { position: fixed; inset: 0; z-index: 2147483647; background: #17212bb3; display: none; align-items: center; justify-content: center; padding: 20px; }
      #${ROOT_ID}.bfm-confirming .bfm-confirm-shade { display: flex; }
      #${ROOT_ID} .bfm-dialog { width: min(460px, 100%); background: white; border-radius: 16px; padding: 24px; box-shadow: 0 20px 70px #13263d55; }
      #${ROOT_ID} .bfm-dialog h3 { margin: 0 0 12px; font-size: 19px; }
      #${ROOT_ID} .bfm-dialog p { line-height: 1.6; color: #526072; }
      #${ROOT_ID} .bfm-preview { max-height: 140px; overflow: auto; background: #f5f7fa; border-radius: 8px; padding: 10px; font-size: 13px; line-height: 1.7; }
      #${ROOT_ID} .bfm-dialog-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
      @media (max-width: 600px) { #${ROOT_ID} .bfm-shade { padding: 0; } #${ROOT_ID} .bfm-panel { width: 100%; height: 100%; border-radius: 0; } #${ROOT_ID} .bfm-header, #${ROOT_ID} .bfm-toolbar, #${ROOT_ID} .bfm-footer { padding-left: 16px; padding-right: 16px; } #${ROOT_ID} .bfm-list { padding: 14px 16px; } }
    </style>
    <button class="bfm-launch" type="button">管理关注</button>
    <div class="bfm-shade"><section class="bfm-panel" role="dialog" aria-modal="true" aria-label="关注管理器">
      <header class="bfm-header"><div><h2>关注管理器</h2><div class="bfm-subtitle">筛选并勾选账号，再选择批量操作</div></div><button class="bfm-text-button bfm-close" type="button" aria-label="关闭">✕</button></header>
      <div class="bfm-toolbar"><input class="bfm-search" type="search" placeholder="搜索昵称、简介或 UID" aria-label="搜索关注" /><button class="bfm-secondary bfm-select-visible" type="button">选中筛选结果</button><button class="bfm-secondary bfm-clear" type="button">清空选择</button><button class="bfm-secondary bfm-reload" type="button">重新加载</button></div>
      <div class="bfm-filter-heading">分组筛选 · 可多选，显示符合任一分组的账号</div><div class="bfm-filters" aria-label="按分组筛选，可多选"></div><div class="bfm-status" role="status"></div><div class="bfm-list"></div>
      <footer class="bfm-footer"><span class="bfm-selected">已选 0 人</span><span class="bfm-progress"></span>
        <select class="bfm-select bfm-operation" aria-label="批量操作">${Object.entries(OPERATIONS).map(([key, item]) => `<option value="${key}">${item.label}</option>`).join('')}</select>
        <select class="bfm-select bfm-group" aria-label="目标分组" hidden><option value="">选择目标分组</option></select>
        <button class="bfm-secondary bfm-stop" type="button" hidden>停止</button><button class="bfm-danger bfm-submit" type="button" disabled>取消关注所选账号</button></footer>
    </section></div>
    <div class="bfm-confirm-shade"><section class="bfm-dialog" role="alertdialog" aria-modal="true" aria-label="确认取消关注"><h3>确认取消关注</h3><p class="bfm-confirm-text"></p><div class="bfm-preview"></div><div class="bfm-dialog-actions"><button class="bfm-secondary bfm-cancel" type="button">返回检查</button><button class="bfm-danger bfm-confirm" type="button">确认执行</button></div></section></div>`;
  document.body.append(root);
  const $ = selector => root.querySelector(selector);

  function visiblePeople() {
    const q = state.query.trim().toLocaleLowerCase();
    return state.people.filter(person => {
      if (q && !`${person.uname} ${person.sign} ${person.mid}`.toLocaleLowerCase().includes(q)) return false;
      return !state.groupFilters.size || [...state.groupFilters].some(key => belongsToFilter(person, key));
    });
  }

  function belongsToFilter(person, key) {
    const tags = Array.isArray(person.tag) ? person.tag.map(Number) : [];
    if (key === 'ungrouped') return !tags.some(tag => tag > 0);
    if (key === 'special') return !!person.special || tags.includes(-10);
    return tags.includes(Number(key.slice(6)));
  }

  function groupNames(person) {
    const ids = Array.isArray(person.tag) ? person.tag.map(Number).filter(id => id > 0) : [];
    if (!ids.length) return ['未分组'];
    return ids.map(id => state.groups.find(group => Number(group.tagid) === id)?.name || `分组 ${id}`);
  }

  function groupOperation() {
    return state.operation === 'groupAdd' || state.operation === 'groupMove';
  }

  function availableGroups() {
    return state.groups.filter(group => Number.isInteger(Number(group.tagid))
      && Number(group.tagid) >= 0 && (state.operation !== 'groupAdd' || Number(group.tagid) !== 0));
  }

  function render() {
    const visible = visiblePeople();
    root.classList.toggle('bfm-open', state.open);
    const filters = [
      { key: 'all', label: '全部', count: state.people.length },
      { key: 'ungrouped', label: '未分组', count: state.people.filter(person => belongsToFilter(person, 'ungrouped')).length },
      { key: 'special', label: '特别关注', count: state.people.filter(person => belongsToFilter(person, 'special')).length },
      ...state.groups.filter(group => Number(group.tagid) > 0).map(group => {
        const key = `group:${group.tagid}`;
        return { key, label: group.name, count: state.people.filter(person => belongsToFilter(person, key)).length };
      }),
    ];
    $('.bfm-filters').innerHTML = filters.map(filter => `<button class="bfm-filter" type="button" data-group-filter="${filter.key}" aria-pressed="${filter.key === 'all' ? !state.groupFilters.size : state.groupFilters.has(filter.key)}">${escapeHtml(filter.label)} ${filter.count}</button>`).join('');
    $('.bfm-status').classList.toggle('bfm-error', !!state.error);
    $('.bfm-status').textContent = state.error || (groupOperation() && state.groupError) || state.message || (state.loading
      ? `正在加载关注列表：已读取 ${state.people.length} 人…`
      : state.loaded
        ? `已读取 ${state.people.length}${state.partial ? ` / ${state.total}` : ''} 人 · 当前筛选 ${visible.length} 人${state.partial ? ' · 列表未完整加载' : ''}`
        : '打开后读取你的关注列表');
    $('.bfm-selected').textContent = `已选 ${state.selected.size} 人`;
    $('.bfm-progress').textContent = state.running ? `已完成 ${state.done} / ${state.runTotal}` : '';
    $('.bfm-stop').hidden = !state.running;
    $('.bfm-stop').disabled = state.stopping;
    $('.bfm-stop').textContent = state.stopping ? '正在停止…' : '停止';
    const groups = availableGroups();
    const groupSelect = $('.bfm-group');
    groupSelect.hidden = !groupOperation();
    groupSelect.innerHTML = `<option value="">选择目标分组</option>${groups.map(group => `<option value="${Number(group.tagid)}">${escapeHtml(group.name)}</option>`).join('')}`;
    if (groups.some(group => String(group.tagid) === state.groupId)) groupSelect.value = state.groupId;
    else state.groupId = '';
    $('.bfm-operation').value = state.operation;
    $('.bfm-operation').disabled = state.running || state.loading;
    groupSelect.disabled = state.running || state.loading;
    const submit = $('.bfm-submit');
    submit.textContent = `${OPERATIONS[state.operation].verb}所选账号`;
    submit.className = `${OPERATIONS[state.operation].destructive ? 'bfm-danger' : 'bfm-primary'} bfm-submit`;
    submit.disabled = state.running || state.loading || state.selected.size === 0 || (groupOperation() && !state.groupId);
    $('.bfm-select-visible').disabled = state.running || state.loading || !visible.length;
    $('.bfm-clear').disabled = state.running || state.selected.size === 0;
    $('.bfm-reload').disabled = state.running || state.loading;
    $('.bfm-close').disabled = state.running;
    $('.bfm-list').innerHTML = visible.length ? visible.map(person => `
      <label class="bfm-card"><input type="checkbox" data-mid="${person.mid}" ${state.selected.has(String(person.mid)) ? 'checked' : ''} ${state.running ? 'disabled' : ''} />
        <img class="bfm-avatar" src="${escapeHtml(/^https:\/\//.test(person.face || '') ? person.face : '')}" alt="" referrerpolicy="no-referrer" />
        <span class="bfm-person"><span class="bfm-name" title="${escapeHtml(person.uname)}">${escapeHtml(person.uname)}</span><span class="bfm-meta">UID ${escapeHtml(person.mid)}${person.special ? ' · 特别关注' : ''}${person.attribute === 6 ? ' · 互相关注' : ''}</span><span class="bfm-groups" title="${escapeHtml(groupNames(person).join('、'))}">${escapeHtml(groupNames(person).join('、'))}</span><span class="bfm-sign" title="${escapeHtml(person.sign)}">${escapeHtml(person.sign || '暂无简介')}</span></span>
      </label>`).join('') : `<div class="bfm-empty">${state.loading ? '正在读取…' : state.loaded ? '没有匹配的关注账号' : '关注列表尚未加载'}</div>`;
  }

  async function loadPeople() {
    if (state.loading || state.running) return;
    state.loading = true; state.error = ''; state.message = ''; state.partial = false; state.loaded = false;
    state.people = []; state.groups = []; state.groupError = ''; state.selected.clear(); state.groupFilters.clear(); state.total = 0; render();
    try {
      try {
        const tags = await request('GET', '/x/relation/tags');
        if (!Array.isArray(tags)) throw new Error('分组响应缺少数据');
        state.groups = [{ tagid: 0, name: '默认分组' }, ...tags.filter(tag => Number(tag.tagid) > 0)];
      } catch (error) {
        state.groupError = `读取分组失败：${error.message}。可以使用其他操作或重新加载。`;
      }
      for (let pn = 1; ; pn++) {
        const query = new URLSearchParams({ vmid: ownMid, pn: String(pn), ps: String(PAGE_SIZE), order: 'desc' });
        const data = await request('GET', `/x/relation/followings?${query}`);
        if (!data || !Array.isArray(data.list)) throw new Error('关注列表响应缺少数据');
        state.total = Number(data.total) || 0;
        const known = new Set(state.people.map(person => String(person.mid)));
        for (const person of data.list) if (person?.mid && !known.has(String(person.mid))) {
          state.people.push(person); known.add(String(person.mid));
        }
        render();
        if (!data.list.length || state.people.length >= state.total || data.list.length < PAGE_SIZE) break;
        await sleep(LOAD_PAUSE_MS);
      }
      state.loaded = true;
      if (state.people.length < state.total) {
        state.partial = true;
        state.error = `只读取到 ${state.people.length} / ${state.total} 人。仅能操作已读取的账号。`;
      }
    } catch (error) {
      state.loaded = state.people.length > 0;
      state.partial = true;
      state.error = `加载中断：${error.message}。${state.people.length ? '仍可操作已读取的账号。' : '请检查登录状态后重试。'}`;
    } finally { state.loading = false; render(); }
  }

  async function applyOperation(person, csrf, operation, groupId) {
    const mid = String(person.mid);
    if (operation === 'unfollow' || operation === 'block') {
      const act = operation === 'block' ? '5' : '2';
      await request('POST', '/x/relation/modify', new URLSearchParams({ fid: mid, act, re_src: '11', csrf }));
      return;
    }
    const tags = Array.isArray(person.tag) ? person.tag.map(Number).filter(tag => Number.isInteger(tag) && tag !== 0) : [];
    if (operation === 'groupAdd') {
      const target = Number(groupId);
      if (tags.includes(target)) return;
      await request('POST', '/x/relation/tags/copyUsers', new URLSearchParams({ fids: mid, tagids: String(target), csrf }));
      person.tag = [...tags, target];
      return;
    }
    if (operation === 'specialAdd') {
      if (tags.includes(-10) || person.special) return;
      const updated = [...new Set([...tags.filter(tag => tag > 0), -10])];
      await request('POST', '/x/relation/tags/addUsers', new URLSearchParams({ fids: mid, tagids: updated.join(','), csrf }));
      person.tag = updated;
      person.special = 1;
      return;
    }
    if (operation === 'groupMove') {
      const target = Number(groupId);
      if (tags.length === 1 && tags[0] === target) return;
      await request('POST', '/x/relation/tags/addUsers', new URLSearchParams({ fids: mid, tagids: String(target), csrf }));
      person.tag = target === 0 ? [] : [target];
      person.special = 0;
      return;
    }
    if (operation === 'specialRemove') {
      if (!tags.includes(-10) && !person.special) return;
      const remaining = tags.filter(tag => tag > 0);
      await request('POST', '/x/relation/tags/addUsers', new URLSearchParams({ fids: mid, tagids: remaining.join(',') || '0', csrf }));
      person.tag = remaining;
      person.special = 0;
    }
  }

  async function runSelected() {
    root.classList.remove('bfm-confirming');
    const csrf = cookie('bili_jct');
    if (!csrf) { state.error = '找不到登录校验信息 bili_jct，请重新登录后重试。'; render(); return; }
    const targets = state.people.filter(person => state.selected.has(String(person.mid)));
    if (!targets.length) return;
    const operation = state.operation;
    const groupId = state.groupId;
    state.running = true; state.stopping = false; state.done = 0; state.runTotal = targets.length; state.error = ''; state.message = ''; render();
    for (const person of targets) {
      if (state.stopping) break;
      try {
        await applyOperation(person, csrf, operation, groupId);
        if (operation === 'unfollow' || operation === 'block') {
          state.people = state.people.filter(item => String(item.mid) !== String(person.mid));
          state.total = Math.max(0, state.total - 1);
        }
        state.selected.delete(String(person.mid));
        state.done++;
      } catch (error) {
        state.error = `在「${person.uname}」处停止：${error.message}。已完成 ${state.done} 人，其余仍保持选中。`;
        break;
      }
      render();
      if (state.done < targets.length) await sleep(PAUSE_MS);
    }
    if (!state.error) state.message = state.stopping
      ? `已停止，成功${OPERATIONS[operation].verb} ${state.done} 人；未处理账号仍保持选中。`
      : `完成：成功${OPERATIONS[operation].verb} ${state.done} 人。`;
    state.running = false; state.stopping = false; render();
  }

  $('.bfm-launch').addEventListener('click', () => { state.open = true; render(); if (!state.loaded && !state.loading) loadPeople(); });
  $('.bfm-close').addEventListener('click', () => { state.open = false; render(); });
  $('.bfm-search').addEventListener('input', event => { state.query = event.target.value; render(); });
  $('.bfm-filters').addEventListener('click', event => {
    const key = event.target.closest('button[data-group-filter]')?.dataset.groupFilter;
    if (!key) return;
    if (key === 'all') state.groupFilters.clear();
    else if (state.groupFilters.has(key)) state.groupFilters.delete(key);
    else state.groupFilters.add(key);
    render();
  });
  $('.bfm-list').addEventListener('change', event => {
    const mid = event.target.dataset.mid;
    if (!mid || state.running) return;
    if (event.target.checked) state.selected.add(mid); else state.selected.delete(mid);
    render();
  });
  $('.bfm-select-visible').addEventListener('click', () => { visiblePeople().forEach(person => state.selected.add(String(person.mid))); render(); });
  $('.bfm-clear').addEventListener('click', () => { state.selected.clear(); render(); });
  $('.bfm-reload').addEventListener('click', loadPeople);
  $('.bfm-operation').addEventListener('change', event => {
    state.operation = event.target.value; state.groupId = ''; state.error = ''; state.message = ''; render();
  });
  $('.bfm-group').addEventListener('change', event => { state.groupId = event.target.value; render(); });
  $('.bfm-stop').addEventListener('click', () => { state.stopping = true; render(); });
  $('.bfm-submit').addEventListener('click', () => {
    const targets = state.people.filter(person => state.selected.has(String(person.mid)));
    if (!targets.length) return;
    if (groupOperation() && !state.groupId) return;
    const verb = OPERATIONS[state.operation].verb;
    const group = state.groups.find(item => String(item.tagid) === state.groupId);
    const destination = groupOperation() ? `「${group?.name || '未知分组'}」` : '';
    const consequence = state.operation === 'block'
      ? '加入黑名单可能同时解除关注关系。'
      : state.operation === 'groupMove' ? '这会替换账号现有的分组设置。'
      : state.operation === 'unfollow' ? '取消关注后不会自动恢复。' : '';
    $('.bfm-confirm-text').textContent = `即将对 ${targets.length} 人执行「${verb}${destination}」。${consequence}操作会逐个执行，已成功的部分不会因停止而恢复。`;
    $('.bfm-preview').textContent = targets.map(person => `${person.uname}（UID ${person.mid}）`).join('、');
    $('.bfm-confirm').textContent = `确认${verb}`;
    root.classList.add('bfm-confirming');
  });
  $('.bfm-cancel').addEventListener('click', () => root.classList.remove('bfm-confirming'));
  $('.bfm-confirm').addEventListener('click', runSelected);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !state.running) {
      root.classList.remove('bfm-confirming'); state.open = false; render();
    }
  });
  render();
})();
