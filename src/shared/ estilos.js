export const css = `
  @import url('https://fonts.bunny.net/css?family=geist:400,500,600,700,800&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'Geist',sans-serif;background:#f0f2f5;min-height:100vh;}
  .topbar{background:#1a3a6b;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100;}
  .btn-gw{background:transparent;color:#fff;border:0.5px solid rgba(255,255,255,0.3);border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;font-family:'Geist',sans-serif;}
  .admin-nav{display:flex;gap:6px;padding:12px 20px;background:#fff;border-bottom:0.5px solid #e4e7ec;overflow-x:auto;}
  .nav-btn{padding:7px 14px;font-size:13px;border-radius:8px;border:none;cursor:pointer;background:transparent;color:#666;font-family:'Geist',sans-serif;white-space:nowrap;}
  .nav-btn.active{background:#eef2ff;color:#1a3a6b;font-weight:600;}
  .pg{padding:20px;max-width:1400px;margin:0 auto;padding-bottom:40px;}
  .pg-detail{padding:20px;max-width:960px;margin:0 auto;padding-bottom:40px;}
  .sec-title{font-size:20px;font-weight:700;color:#1a1a1a;margin-bottom:4px;}
  .sec-sub{font-size:13px;color:#666;margin-bottom:20px;}
  .form-card{background:#fff;border:0.5px solid #e4e7ec;border-radius:14px;padding:20px;margin-bottom:16px;}
  .form-title{font-size:14px;font-weight:600;color:#1a1a1a;margin-bottom:14px;}
  .field-row{margin-bottom:14px;}
  .field-label{font-size:12px;color:#555;margin-bottom:4px;display:block;font-weight:500;}
  input,select,textarea{width:100%;padding:9px 12px;border:0.5px solid #d0d5dd;border-radius:8px;font-size:13px;background:#fff;color:#1a1a1a;font-family:'Geist',sans-serif;outline:none;}
  textarea{height:80px;resize:none;}
  .two-col{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;}
  .three-col{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;}
  .btn-orange{background:#F47B20;color:#fff;border:none;border-radius:10px;padding:10px 18px;font-size:13px;font-weight:600;cursor:pointer;font-family:'Geist',sans-serif;}
  .btn-orange:disabled{background:#ccc;cursor:not-allowed;}
  .btn-blue{background:#1a3a6b;color:#fff;border:none;border-radius:10px;padding:10px 18px;font-size:13px;font-weight:600;cursor:pointer;font-family:'Geist',sans-serif;}
  .btn-blue:disabled{background:#ccc;cursor:not-allowed;}
  .btn-back{background:transparent;border:none;cursor:pointer;font-size:13px;color:#1a3a6b;font-weight:600;font-family:'Geist',sans-serif;padding:0;}
  .login-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f0f2f5;padding:20px;}
  .login-card{background:#fff;border-radius:16px;padding:40px 32px;width:100%;max-width:400px;border:0.5px solid #e4e7ec;}
  .loading{text-align:center;padding:40px;color:#888;font-size:14px;}
  .empty{text-align:center;padding:32px;color:#888;font-size:13px;background:#fff;border-radius:12px;border:0.5px dashed #e4e7ec;}
  .badge{font-size:11px;padding:3px 10px;border-radius:20px;font-weight:600;white-space:nowrap;}
  .badge-pendiente{background:#fef3c7;color:#92400e;}
  .badge-enviado{background:#dbeafe;color:#1e40af;}
  .badge-aprobado{background:#dcfce7;color:#166534;}
  .badge-rechazado{background:#fee2e2;color:#c0392b;}
  .kanban-board{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;align-items:start;}
  .kanban-col{background:#f8f9fa;border-radius:12px;padding:12px;min-height:200px;}
  .kanban-col-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding:8px 10px;border-radius:8px;}
  .kanban-card{background:#fff;border-radius:10px;padding:12px;margin-bottom:8px;cursor:pointer;border:1px solid #e4e7ec;transition:box-shadow 0.15s,transform 0.1s;}
  .kanban-card:hover{box-shadow:0 4px 12px rgba(0,0,0,0.1);transform:translateY(-1px);}
  @keyframes biggypulse{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}
  @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  .biggy-bubble{animation:fadeIn 0.4s ease;}
  .biggy-typing span{display:inline-block;width:7px;height:7px;border-radius:50%;background:#F47B20;margin:0 2px;animation:biggypulse 0.9s infinite;}
  .biggy-typing span:nth-child(2){animation-delay:0.2s;}
  .biggy-typing span:nth-child(3){animation-delay:0.4s;}
  @media(max-width:900px){.kanban-board{grid-template-columns:1fr 1fr;}}
  @media(max-width:560px){.kanban-board{grid-template-columns:1fr;}.three-col{grid-template-columns:1fr;}.two-col{grid-template-columns:1fr;}}
`;
