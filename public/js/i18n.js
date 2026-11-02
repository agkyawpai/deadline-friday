// UI text (Myanmar only). Params: {name}. A param value starting with '@' is itself translated.
const MM = {
  title: 'Deadline: သောကြာ ညနေ ၅ နာရီ',
  subtitle: 'IT ရုံး Chaos ဂိမ်း · Online / LAN · ၁–၆ ယောက်',
  yourName: 'သင့်နာမည်',
  createRoom: 'ရုံးအသစ် ဖွင့်မယ် 🏢', or: '— ဒါမှမဟုတ် room code နဲ့ဝင် —', roomCodePh: 'CODE', joinRoom: 'ဝင်မယ်',
  roomCode: 'Room', copyLink: 'Link ကူး', copied: 'ဖိတ်ခေါ် link ကူးပြီးပြီ!',
  noRoom: 'Room မတွေ့ဘူး။ Code ကို ပြန်စစ်ပါ။', syncError: 'ချိတ်ဆက်မှု error။ ထပ်ကြိုးစားပါ။', offline: '📡 ချိတ်ဆက်မှု ပြဿနာ… ပြန်ကြိုးစားနေတယ်',
  waiting: 'Host စတင်ဖို့ စောင့်နေတယ်…',
  start: 'Sprint စမယ် 🚀',
  lobbyPlayers: 'ရုံးထဲမှာ ({n}/6)',
  recommend: 'မစခင် "📖 ကစားနည်း" ကို ဖတ်ထားပါ။ စောင့်နေတုန်း လမ်းလျှောက်ကြည့်!',
  lobby_bots: '🤖 လူ ၄ ယောက် မပြည့်လို့ Bot {n} ကောင် ဝင်ဆော့ပေးမယ် — Bot တစ်ကောင်က သစ္စာဖောက် ဖြစ်နိုင်တယ်!',
  full: 'ရုံးပြည့်နေပြီ (၆/၆)။',
  inProgress: 'Sprint စနေပြီ။ ပြီးတဲ့အထိ စောင့်ပြီး refresh လုပ်ပါ။',
  host: 'HOST',
  controls: 'ရွှေ့: WASD / click · E: လုပ်ဆောင် · Q: ability · F: sabotage · B: board · Enter: chat · 1–5: emote',
  rulesBtn: '📖 ကစားနည်း',

  day1: 'တနင်္လာ', day2: 'အင်္ဂါ', day3: 'ဗုဒ္ဓဟူး', day4: 'ကြာသပတေး', day5: 'သောကြာ',
  day5_note: 'ဒီနေ့ နေ့လယ် Deploy လုပ်ရမယ်! 🚀',
  hud_client: 'Client', hud_ceo: '👴 CEO {s}s', hud_fire: '🔥 မီးလောင်', hud_pip: '📉 PIP', hud_caught: '🚔 မိသွားပြီ', hud_boost: '⚡ {s}s',

  role_leader: 'Team Leader', role_senior: 'Senior Dev', role_junior: 'Junior Dev', role_qa: 'QA Tester',
  rdesc_senior: 'Code ×1.5 မြန်တယ်။ Ability: Refactor — ticket တွေထဲက ဝှက်ထားတဲ့ bug တစ်ဝက် ပျောက်။',
  rdesc_junior: 'Code ×1၊ bug အများကြီး ထွက်တယ်။ Ability: AI ကိုမေး — 50% ticket အများကြီး ပြီး၊ 50% bug ထပ်တိုး 🎲',
  rdesc_qa: 'Test လုပ်ရင် bug ×2 ရှင်း။ Ability: Git Blame — နောက်ဆုံး sabotage ကို ဘယ်သူလုပ်လဲ သင်တစ်ယောက်တည်း သိရမယ်။',
  rdesc_leader: 'Code ×1.1။ Ability: Emergency Meeting — ချက်ချင်း မဲပေးပွဲ ခေါ် (တစ်ရက် ၁ ကြိမ်)။',
  ab_leader: 'Emergency Meeting', ab_senior: 'Refactor', ab_junior: 'AI ကိုမေး', ab_qa: 'Git Blame',

  ag_team: '👷 ပုံမှန် ဝန်ထမ်း', agd_team: 'App ကို Ship လုပ်ပြီး သစ္စာဖောက်ကို ရှာပါ။',
  ag_jobhunt: '🕵️ သစ္စာဖောက် (Job Hunter)', agd_jobhunt: 'တခြားကုမ္ပဏီက offer ရထားပြီ! F နဲ့ ticket ထဲ bug ထည့်၊ deploy အချိန် server ကြိုးဖြုတ်။ မမိစေနဲ့!',

  brief_role: 'သင့်ရာထူး', brief_agenda: 'သင်က… (ဘယ်သူ့မှ မပြောနဲ့!)',
  brief_mission: '🎯 ပန်းတိုင်: သောကြာ ညနေ ၅ နာရီ မတိုင်ခင် App ကို Deploy လုပ်ရမယ်။',
  brief_win_team: '🏆 သင်နိုင်ဖို့: အဖွဲ့ Ship ဖြစ်ရမယ် (သောကြာ Deploy အောင် + ticket ၄၀% အထက်)။',
  brief_win_evil: '🏆 သင်နိုင်ဖို့: အဖွဲ့ Ship မဖြစ်စေရဘူး! ဒါပေမဲ့ မမိစေနဲ့။',
  brief_tip: '⚡ ထိပ်က အဝါရောင်စာတန်းက သင်လုပ်ရမယ့်အလုပ်ကို အမြဲ ပြပေးမယ်။',
  brief_starts: 'တနင်္လာနေ့ {s} စက္ကန့်အတွင်း စမယ်…',

  tk_login: 'Login စာမျက်နှာ', tk_payment: 'ငွေပေးချေမှု', tk_chatbot: 'AI Chatbot', tk_darkmode: 'Dark mode', tk_nft: 'NFT ဆုလာဘ်', tk_map: 'Live မြေပုံ',
  tk_push: 'Push notification', tk_search: 'ရှာဖွေမှု', tk_loyalty: 'Loyalty point', tk_reviews: 'အစားအသောက် review', tk_referral: 'မိတ်ဆက် program', tk_export: 'CSV export',
  stage_todo: 'လုပ်ရန်', stage_dev: 'Code', stage_qa: 'Test', stage_done: 'ပြီး',
  board_title: '📋 Sprint Board', claim: 'ယူမယ်', by: '{name}', unclaimed: 'ပိုင်ရှင်မရှိ', boardBtn: '📋 Board (B)',
  needs_tester: 'တခြားတစ်ယောက် test လုပ်ပေးရမယ်', credit_line: 'Code: {code} · Test: {test}',

  hint_claim: '📋 Sprint Board (B) မှာ ticket တစ်ခု ယူပါ',
  hint_code: '💻 “{ticket}” ကို desk မှာ code ရေး ({p}/{w})',
  hint_help: '🤝 “{ticket}” ကို desk မှာ ကူရေးပေး',
  hint_qa: '🔍 “{ticket}” ကို QA lab မှာ test လုပ်ပေး',
  hint_wait: '⏳ သင့် “{ticket}” က test စောင့်နေတယ် — Slack မှာ တစ်ယောက်ယောက်ကို ပြောပါ',
  hint_deploy: '🚀 လင်းနေတဲ့ နေရာမှာ ရပ်ပြီး E (ဒါမှမဟုတ် ခလုတ်) ကို ဖိထား!',
  hint_idle: '☕ ကော်ဖီသောက်ရင် ⚡ ခဏ မြန်တယ်။ #git-log ကိုလည်း စောင့်ကြည့်!',
  hint_caught: '🚔 သင် မိသွားပြီ… sabotage မလုပ်နိုင်တော့ဘူး',

  act_code: '💻 Code ရေး', act_qa: '🔍 Test', act_board: '📋 Sprint Board', act_hold: '🚀 ဖိထား — deploy',
  act_coffee: '☕ ကော်ဖီ (⚡)', act_fire: '🧯 မီးငြိမ်း', act_phone: '📞 Client ဖုန်းကိုင်', act_pizza: '🍕 Pizza (⚡)',
  boostOn: '⚡ ခဏ မြန်သွားပြီ!',

  mg_pick_ticket: 'Ticket:', mg_no_ticket: 'Code ရေးစရာ ticket မရှိဘူး။ Sprint Board မှာ တစ်ခု ယူပါ။', mg_open_board: '📋 Board ဖွင့်',
  mg_code_title: 'Code ရေး! မြှားတွေကို အစဉ်လိုက် နှိပ်',
  mg_code_done: '+{amt} ✅', mg_code_wrong: 'Syntax error!', mg_compiling: 'Compile လုပ်နေတယ်…',
  mg_qa_title: '“{ticket}” test: 🐛 အားလုံး နှိမ်! {s}s', mg_qa_pass: 'အားလုံး ရှင်းပြီ! ✅ ticket ပြီးပြီ', mg_qa_left: 'Bug {n} ကောင် ကျန်သေးတယ် — ထပ် test လုပ်',
  mg_qa_wait: 'Test run နေတယ်…',
  mg_again: 'ထပ်လုပ်', mg_close: 'ပိတ် (Esc)',
  mg_fire_title: 'Server မီးလောင်နေပြီ! မီးသတ်ဆေး ဆက်တိုက်နှိပ်!', mg_spray: '🧯 ဖျန်း!', mg_fixed: 'ငြိမ်းပြီ! 🎉', mg_coffee: 'ကော်ဖီဖျော်နေတယ်… ☕',
  phone_q0: '“NFT login လည်း ထည့်လို့ရမလား? သောကြာနေ့ မတိုင်ခင်ပေါ့”',
  phone_q1: '“Logo ကို ကြီးကြီးလုပ်ပေး။ သေးသေးလည်း လုပ်ပေး။ တစ်ပြိုင်နက်တည်း။”',
  phone_q2: '“ကျွန်တော့်တူက blockchain ပေါ်မှာ ရှိရမယ်တဲ့။ ရှိလား?”',
  phone_q3: '“App က offline လည်း အလုပ်လုပ်ရမယ်၊ live data လည်း ပြရမယ်နော်?”',
  phone_a0: 'ရပါတယ် ခင်ဗျာ! 😁 (client ++၊ ticket +1)',
  phone_a1: 'Team နဲ့ တိုင်ပင်ပြီး ပြန်ပြောပါမယ် 🤔 (client +)',
  phone_title: '📞 Client ဖုန်းထဲမှာ',

  morning_title: '🌅 {day} မနက်', morning_claim: 'Ticket ယူပါ (နောက်မှ board မှာလည်း ယူလို့ရ)။ Slack မှာ ညှိကြ!',
  morning_starts: '{s} စက္ကန့်အတွင်း အလုပ်စမယ်',
  evening_title: '🌙 {day} ပြီးပါပြီ', evening_done: 'ဒီနေ့ ပြီးတဲ့ ticket', evening_total: 'စုစုပေါင်း', evening_client: 'Client',
  evening_next: 'နောက်တစ်နေ့: {day}',

  mt_title: '🗳️ သစ္စာဖောက်က ဘယ်သူလဲ?', mt_emergency: '🚨 {name} က emergency meeting ခေါ်လိုက်တယ်',
  mt_info: '#git-log သဲလွန်စ (အရောင် / role) ကို ကြည့်ပြီး Slack မှာ ဆွေးနွေးပါ။ မဲ ၂ မဲ အနည်းဆုံး ရရင် ဖမ်းမယ်။ မှားဖမ်းရင် အဲဒီလူ မနက်ဖြန်အထိ PIP (ability ပိတ်) ခံရမယ်။',
  mt_skip: 'ကျော် (ဘယ်သူ့မှ မဖမ်း)', mt_voted: '{n}/{total} မဲပေးပြီး', mt_left: '{s}s ကျန်', mt_myVote: 'မဲပေးပြီး ✓',
  mt_caught: '🎉 {name} က သစ္စာဖောက် ဖြစ်တယ်! ဖမ်းမိပြီ — sabotage မလုပ်နိုင်တော့ဘူး (မဲ {n})',
  mt_innocent: '😬 {name} က အပြစ်မဲ့သူ! မှားဖမ်းမိလို့ မနက်ဖြန်အထိ PIP (မဲ {n})',
  mt_nobody: '🗳️ ဘယ်သူ့မှ မဖမ်းဖြစ်ဘူး။',
  ev_meeting: '🗳️ နေ့လယ် meeting! သစ္စာဖောက်ကို ရှာကြမယ်', ev_emergency: '🚨 {name} က emergency meeting ခေါ်လိုက်ပြီ!',

  ev_deploy: '🚀 DEPLOY အချိန်! လင်းနေတဲ့ နေရာတွေကို အတူတူ ဖိထား!', ev_deployed: '🎉 Production ကို deploy လုပ်ပြီးပြီ!', ev_deployFailed: '💥 Deploy ကျသွားပြီ — အချိန်ကုန်သွားတယ်',
  deploy_title: '🚀 Deploy {p}%', deploy_need: 'ဖိထားတဲ့ နေရာ: {o}/{n}',
  ev_ticketDone: '✅ “{ticket}” ပြီးပြီ! client +6',

  git_stage: '{name} က “{ticket}” ကို → {stage} ရွှေ့လိုက်တယ်',
  git_sus: '⚠️ #{id} {time} — {place} နားမှာ သံသယဖြစ်စရာ {act}။ မြင်တဲ့သူ ပြောတာ: {clue}',
  git_blame: '🔎 git blame #{id} → {name} (သင်တစ်ယောက်တည်း မြင်ရတယ်)',
  git_blame_none: '🔎 Blame လုပ်စရာ မရှိသေးဘူး။',
  gitact_inject: 'commit (bug ထည့်)', gitact_unplug: 'ကြိုးဖြုတ်',
  place_desk: 'desk တွေ', place_board: 'Sprint Board', place_qa: 'QA lab', place_coffee: 'ကော်ဖီစက်',
  place_server: 'server ခန်း', place_meeting: 'meeting room', place_phone: 'Sales desk', place_exit: 'ထွက်ပေါက်',

  sec_btn: 'F · 🤫 Sabotage', sec_done: '🤫 Sabotage ပြီးပြီ။ ဘာမှမဖြစ်သလို နေ…',
  sec_nothing: '🤫 Bug ထည့်စရာ ticket မရှိဘူး။', sec_needServer: '🤫 Deploy အချိန်မှာ server နားကို သွားပြီးမှ ကြိုးဖြုတ်လို့ရတယ်။',

  ev_fire: '🔥 Production ကျပြီ! Server ခန်း မီးလောင်နေပြီ!',
  ev_fireout: '🧯 {name} မီးငြိမ်းလိုက်ပြီ!',
  ev_phone: '📞 Client ဖုန်းဆက်နေပြီ! ၁၅ စက္ကန့်အတွင်း ကိုင်ပါ',
  ev_phoneMissed: '📵 ဘယ်သူမှ ဖုန်းမကိုင်ဘူး။ Client စိတ်တိုနေပြီ (−10)',
  ev_phoneYes: '😁 {name}: “ရပါတယ်!” ticket +1',
  ev_phoneCheck: '🤔 {name} က client ကို ယဉ်ယဉ်ကျေးကျေး ဖြေရှင်းလိုက်တယ်။',
  ev_ceo: '👴 CEO ရုံးထဲ လှည့်ပတ်နေတယ်! CEO ပြန်မထွက်ခင် desk မှာ ရှိနေပါ!',
  ev_ceoEnd: '👴 CEO ပြန်သွားပြီ။ အလုပ်မလုပ်တာ မိသွားသူ: {names}',
  ev_ceoGood: '👴 CEO သဘောကျပြီး ပြန်သွားတယ်။ အားလုံး အလုပ်ရှုပ်နေပုံ ပေါက်တယ်!',
  ev_pizza: '🍕 Meeting room မှာ Pizza အလကား! စားရင် ⚡ ၃၀ စက္ကန့် မြန်',
  ab_used_senior: '🧙 {name} refactor လုပ်လိုက်တယ် — bug တွေ တစ်ဝက် ပျောက်',
  ab_used_junior_good: '🤖 {name} AI ကိုမေးလိုက်တာ… တကယ် အလုပ်ဖြစ်သွားတယ်!',
  ab_used_junior: '🤖 {name} AI ကို အကူအညီတောင်းလိုက်တယ်… “Looks good to me!” တဲ့',
  ab_used_qa: '🔎 {name} က #{id} ကို git blame လုပ်လိုက်တယ်…',
  ab_noTicket: 'သုံးစရာ ticket မရှိဘူး။',

  emote0: 'ကျွန်တော့်စက်မှာတော့ အလုပ်လုပ်တယ်! 🤷', emote1: 'ငါ့ bug မဟုတ်ဘူး 🙅', emote2: 'Test လုပ်ပေးပါဦး 🙏',
  emote3: 'LGTM 👍', emote4: 'ဘယ်သူ bug ထည့်တာလဲ?! 😡',

  ch_general: '#general', ch_git: '#git-log', chat_everyone: 'အားလုံး', chat_ph: 'စာရိုက်…', chat_dm: 'DM',
  chat_dm_to: 'DM → {name}', chat_dm_from: 'DM',

  end_shipped: '🏆 Ship ဖြစ်ပြီ!', endd_shipped: 'Ticket {done}/{total} နဲ့ deploy လုပ်နိုင်ခဲ့တယ်။ IPO အချိန်ပဲ! 🍾',
  end_onfire: '🔥 Ship ဖြစ်ပြီ… မကျက်တကျက်', endd_onfire: 'Ticket {done}/{total} နဲ့ deploy လုပ်လိုက်တယ်။ Live ဖြစ်နေတယ်… တစ်မျိုးတော့။',
  end_missed: '📉 Feature မလောက်ဘူး', endd_missed: 'Deploy အောင်ပေမယ့် ticket {done}/{total} ပဲ ပြီးတယ် (၄၀% မပြည့်)။',
  end_cancelled: '❌ Project ပယ်ဖျက်ခံရပြီ', endd_cancelled: 'Client ကျေနပ်မှု 0 ရောက်သွားတယ်။ တခြား vendor ကို ငှားလိုက်ပြီ။',
  end_deployfail: '💥 Deploy ကျသွားပြီ', endd_deployfail: 'သောကြာ ညနေ ၅ နာရီ၊ production ကျနေပြီး ဘယ်သူမှ အိမ်မပြန်ရဘူး။',
  res_team_win: '🎉 ဝန်ထမ်းတွေ နိုင်ပြီ!', res_team_lose: '😈 သစ္စာဖောက် နိုင်သွားပြီ…',
  res_hunter: '🕵️ သစ္စာဖောက်က {name} ပါ!', res_hunter_caught: ' (ဖမ်းမိခဲ့တယ် 🚔)', res_hunter_free: ' (မမိခဲ့ဘူး 😈)',
  res_player: 'ကစားသူ', res_role: 'ရာထူး', res_side: 'ဘက်', res_result: 'နိုင်/ရှုံး',
  res_log: '🔎 Git log — အမှန်တရား', res_log_row: '#{id} {time} — {act} လုပ်သူ {actor}', res_log_none: 'ဒီ sprint မှာ sabotage မရှိဘူး။',
  res_win: '✅ နိုင်', res_lose: '❌ ရှုံး', playAgain: 'Lobby ပြန်သွား', waitHost: 'Host ကို စောင့်နေတယ်…',
};

export function t(key, params = {}) {
  const s = MM[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => {
    const v = params[k];
    if (typeof v === 'string' && v.startsWith('@')) return t(v.slice(1));
    return v ?? '';
  });
}
export const ROLE_ICON = { leader: '🧭', senior: '🧙', junior: '🐣', qa: '🔍' };
export const TICKET_ICON = { login: '🔐', payment: '💳', chatbot: '🤖', darkmode: '🌙', nft: '🖼️', map: '🗺️', push: '🔔', search: '🔎', loyalty: '⭐', reviews: '🍜', referral: '🎁', export: '📄' };
export const STAGES = ['todo', 'dev', 'qa', 'done'];
