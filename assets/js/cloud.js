/* 贝琪酱语无痛逆袭站 · 云托管接入（注册登录 + 进度云同步）
 * 纯 HTML 无构建步骤 -> 用 CDN 形式的 SDK，全局 WorkBuddyCloud。
 * publicConfig 三个值来自 workbuddy_cloud_service 激活结果，不要改成别处取来的值。
 */
(function () {
  var APP_ID = 'wbapp_JIIToRd3w6i4uwrIXTrLQq';
  var PUBLIC = {
    endpoint: 'https://becky-ielts.app.workbuddy.host',
    oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
    publishableKey: 'wbpk_JIIToRd3w6i4uwrIXTrLQq_Ou4a3YNQab4HRyP6keOsq7wQWYhxPop7',
  };
  var cloud = null;
  var pending = null;                 // OTP 挑战，放在事件处理器之外
  var pushTimers = {};
  var BOOTED = false;

  function init() {
    if (cloud || !window.WorkBuddyCloud) return cloud;
    cloud = window.WorkBuddyCloud.createWorkBuddyCloud({
      endpoint: PUBLIC.endpoint,
      oauthRelayBaseUrl: PUBLIC.oauthRelayBaseUrl,
      publishableKey: PUBLIC.publishableKey,
    });
    return cloud;
  }

  /* ---------------- 登录视图 ---------------- */
  function loginHtml() {
    return '<div class="card pad" style="max-width:420px;margin:30px auto">' +
      '<h2>登录后云同步进度</h2>' +
      '<div class="muted">换设备不清零，连续打卡天数跟着账号走。</div>' +
      '<div style="margin-top:14px">' +
      '<input id="lgPhone" class="dictate" placeholder="手机号" autocomplete="tel" maxlength="11">' +
      '<div class="muted" id="lgPhoneErr" style="margin-top:5px;color:var(--rose-d)"></div>' +
      '<div class="row" style="margin-top:10px">' +
      '<input id="lgCode" class="dictate" placeholder="验证码" maxlength="6" style="flex:1">' +
      '<button class="btn ghost sm" id="lgSend" type="button">获取验证码</button></div>' +
      '<div class="muted" id="lgMsg" style="margin-top:8px"></div>' +
      '<button class="btn" id="lgSubmit" style="width:100%;margin-top:14px">登录 / 注册</button>' +
      '<button class="btn ghost" id="lgWechat" style="width:100%;margin-top:8px">微信登录</button>' +
      '</div></div>';
  }

  function bindLogin(mount) {
    var phone = mount.querySelector('#lgPhone');
    var code = mount.querySelector('#lgCode');
    var sendBtn = mount.querySelector('#lgSend');
    var subBtn = mount.querySelector('#lgSubmit');
    var wxBtn = mount.querySelector('#lgWechat');
    var err = mount.querySelector('#lgPhoneErr');
    var msg = mount.querySelector('#lgMsg');

    phone.addEventListener('input', function () { err.textContent = ''; });

    sendBtn.onclick = async function () {
      var p = phone.value.trim();
      if (!/^1\d{10}$/.test(p)) {
        err.textContent = '请输入正确的 11 位手机号';
        return;
      }
      err.textContent = '';
      sendBtn.disabled = true;
      var sent = await cloud.auth.sendOtp({ phone: p });   // 不做 +86 拼接，SDK 自己归一化
      sendBtn.disabled = false;
      if (sent.error) {
        msg.textContent = sent.error.message || '验证码发送失败';
        return;
      }
      pending = { phone: p, verificationId: sent.data.verificationId,
                  isExistingUser: sent.data.isExistingUser };
      msg.textContent = '验证码已发送';
    };

    subBtn.onclick = async function () {
      var p = phone.value.trim();
      if (!pending || pending.phone !== p) {
        msg.textContent = '请先为当前手机号获取验证码';
        return;
      }
      var res = await cloud.auth.verifyOtp({
        phone: pending.phone,
        verificationId: pending.verificationId,
        isExistingUser: pending.isExistingUser,
        token: code.value.trim(),
      });
      if (res.error) {
        msg.textContent = res.error.message || '验证码不正确';
        return;                                   // 失败不清 pending，可重试，不重发
      }
      pending = null;
      await afterLogin();
    };

    wxBtn.onclick = async function () {
      var r = await cloud.auth.signInWithOAuth({ provider: 'wechat', redirectTo: location.origin });
      if (r.error) { msg.textContent = r.error.message || '微信登录未开启'; return; }
      location.assign(r.data.url);
    };
  }

  /* ---------------- 同步 ---------------- */
  function laneKeys() {
    return Object.keys(localStorage).filter(function (k) { return k.indexOf('bq8.') === 0; });
  }

  async function pullAll() {
    var res = await cloud.database.from('checkin_progress').select('lane, payload');
    if (res.error || !res.data) return 0;
    res.data.forEach(function (row) {
      if (!row || !row.lane) return;
      var local = {};
      try { local = JSON.parse(localStorage.getItem('bq8.' + row.lane) || '{}'); } catch (e) {}
      localStorage.setItem('bq8.' + row.lane, JSON.stringify(merge(local, row.payload || {})));
    });
    return res.data.length;
  }

  // 云端与本地按词条取更“新”的一份；打卡天数取大者
  function merge(a, b) {
    var out = { rec: {}, log: {}, streak: Math.max(a.streak || 0, b.streak || 0),
                lastDay: (a.lastDay || '') > (b.lastDay || '') ? a.lastDay : b.lastDay,
                mode: a.mode || b.mode || 'curve' };
    ['a', 'b'].forEach(function () {});
    Object.assign(out.rec, b.rec || {}, a.rec || {});
    var k;
    for (k in (b.rec || {})) {
      var x = b.rec[k], y = (a.rec || {})[k];
      out.rec[k] = (!y || (x.last || 0) > (y.last || 0)) ? x : y;
    }
    Object.assign(out.log, b.log || {});
    for (k in (a.log || {})) {
      var p = a.log[k], q = (b.log || {})[k];
      if (p && (!q || (p.new || 0) + (p.rev || 0) > (q.new || 0) + (q.rev || 0))) out.log[k] = p;
    }
    return out;
  }

  function push(lane, store) {
    if (!cloud) return;
    clearTimeout(pushTimers[lane]);
    pushTimers[lane] = setTimeout(async function () {
      var res = await cloud.database.from('checkin_progress')
        .upsert({ lane: lane, payload: store, updated_at: new Date().toISOString() },
                { onConflict: 'owner_id,lane' });
      if (res.error) console.warn('[sync] push failed');   // 不打印行数据
    }, 1200);
  }

  async function afterLogin() {
    var n = await pullAll();
    var u = await cloud.auth.getUser();
    var name = (u && u.data && u.data.user) ? (u.data.user.phone || u.data.user.email || '已登录') : '已登录';
    document.getElementById('view').innerHTML =
      '<div class="card pad" style="max-width:420px;margin:30px auto;text-align:center">' +
      '<div style="font-size:40px">✅</div><h2>已登录</h2>' +
      '<div class="muted">' + String(name).replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2') + '</div>' +
      '<div class="muted" style="margin-top:8px">已同步 ' + n + ' 条航道进度</div>' +
      '<a class="btn" href="#/home" style="margin-top:16px;display:inline-block">开始打卡</a></div>';
    if (location.hash.indexOf('code=') > -1) history.replaceState(null, '', location.pathname);
    setTimeout(function () { location.hash = '#/home'; }, 1200);
  }

  /* ---------------- 引导 ---------------- */
  async function boot() {
    if (BOOTED) return;
    BOOTED = true;
    if (!init()) return;                                  // SDK 没加载就走纯本地
    // 必须无条件先处理微信回调，且要早于任何路由守卫
    var cb = await cloud.auth.handleWechatWebCallback();
    if (cb.error) { console.warn('[auth] callback failed'); }
    else if (cb.data) {
      if (location.hash.indexOf('code=') > -1 || location.search.indexOf('code=') > -1) {
        history.replaceState(null, '', location.pathname);
      }
      await afterLogin();
      return;
    }
    var s = await cloud.auth.getSession();
    if (s && s.data) { await pullAll(); }                 // 已登录：先合并云端进度
  }

  async function showLogin() {
    init();
    document.getElementById('view').innerHTML = loginHtml();
    bindLogin(document.getElementById('view'));
  }

  window.BQCloud = {
    APP_ID: APP_ID, boot: boot, showLogin: showLogin, push: push, pullAll: pullAll,
    isSignedIn: async function () {
      if (!init()) return false;
      var s = await cloud.auth.getSession();
      return !!(s && s.data);
    },
    signOut: async function () { if (init()) await cloud.auth.signOut(); },
  };
})();
