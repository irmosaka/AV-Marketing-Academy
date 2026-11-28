(() => {
  "use strict";

  const avatars = [
    { id: "avatar-01", face: "👨🏻", label: "مرد ۱" },
    { id: "avatar-02", face: "👨🏼", label: "مرد ۲" },
    { id: "avatar-03", face: "👨🏽", label: "مرد ۳" },
    { id: "avatar-04", face: "👨🏾", label: "مرد ۴" },
    { id: "avatar-05", face: "👨🏿", label: "مرد ۵" },
    { id: "avatar-06", face: "🧔🏻", label: "مرد ۶" },
    { id: "avatar-07", face: "👩🏻", label: "زن ۱" },
    { id: "avatar-08", face: "👩🏼", label: "زن ۲" },
    { id: "avatar-09", face: "👩🏽", label: "زن ۳" },
    { id: "avatar-10", face: "👩🏾", label: "زن ۴" },
    { id: "avatar-11", face: "👩🏿", label: "زن ۵" },
    { id: "avatar-12", face: "👩🏻‍🦰", label: "زن ۶" }
  ];

  const config = window.SUPABASE_CONFIG || {};
  const ready = !!(
    window.supabase &&
    config.url &&
    config.anonKey
  );

  if (!ready) {
    console.error("Profile UI: Supabase configuration not found.");
    return;
  }

  const client = window.supabase.createClient(
    config.url,
    config.anonKey,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    }
  );

  let currentUser = null;
  let preferences = {
    avatar_id: "avatar-01",
    theme: "dark"
  };

  const $ = (selector, root = document) => root.querySelector(selector);

  function getAvatar(id) {
    return avatars.find(item => item.id === id) || avatars[0];
  }

  function applyTheme(theme) {
    const safeTheme = theme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = safeTheme;
    document.body.dataset.theme = safeTheme;
    preferences.theme = safeTheme;
    localStorage.setItem("av-academy-theme", safeTheme);
  }

  function applyAvatar(id) {
    const avatar = getAvatar(id);
    preferences.avatar_id = avatar.id;

    ["#userAvatar", "#topAvatar"].forEach(selector => {
      const element = $(selector);
      if (!element) return;
      element.textContent = avatar.face;
      element.classList.add("avatar-emoji");
      element.setAttribute("aria-label", avatar.label);
    });
  }

  function toast(message, isError = false) {
    const element = $("#toast");
    if (!element) return;

    element.textContent = message;
    element.classList.add("show");
    element.classList.toggle("toast-error", isError);

    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => {
      element.classList.remove("show", "toast-error");
    }, 2800);
  }

  async function loadPreferences() {
    const { data: sessionData } = await client.auth.getSession();
    currentUser = sessionData?.session?.user || null;

    if (!currentUser) return;

    const { data, error } = await client.rpc("get_my_preferences");

    if (error) {
      console.error("Could not load preferences:", error.message);
      applyTheme("dark");
      applyAvatar("avatar-01");
      return;
    }

    preferences = {
      avatar_id: data?.avatar_id || "avatar-01",
      theme: data?.theme || "dark"
    };

    applyTheme(preferences.theme);
    applyAvatar(preferences.avatar_id);
  }

  async function savePreferences() {
    if (!currentUser) {
      toast("برای ذخیره تنظیمات ابتدا وارد پرتال شوید.", true);
      return false;
    }

    const { error } = await client.rpc("set_my_preferences", {
      p_avatar_id: preferences.avatar_id,
      p_theme: preferences.theme
    });

    if (error) {
      console.error("Preference save failed:", error.message);
      toast("ذخیره تنظیمات انجام نشد: " + error.message, true);
      return false;
    }

    toast("تنظیمات پروفایل ذخیره شد.");
    return true;
  }

  function createProfileModal() {
    if ($("#profileModal")) return;

    const modal = document.createElement("div");
    modal.id = "profileModal";
    modal.className = "profile-modal";
    modal.innerHTML = `
      <section class="profile-dialog" role="dialog"
        aria-modal="true" aria-labelledby="profileTitle">

        <header class="profile-dialog-head">
          <div>
            <span class="eyebrow">PERSONAL WORKSPACE</span>
            <h2 id="profileTitle">پروفایل و تنظیمات</h2>
            <p>شخصی‌سازی فضای کاری شما</p>
          </div>
          <button type="button" class="profile-close" aria-label="بستن">×</button>
        </header>

        <div class="profile-section">
          <h3>تصویر پروفایل</h3>
          <p>یکی از آواتارهای آماده را انتخاب کنید.</p>
          <div class="avatar-picker">
            ${avatars.map(item => `
              <button type="button"
                class="avatar-option"
                data-avatar="${item.id}"
                aria-label="${item.label}">
                <span>${item.face}</span>
              </button>
            `).join("")}
          </div>
          <small class="profile-hint">امکان بارگذاری عکس شخصی وجود ندارد.</small>
        </div>

        <div class="profile-section">
          <h3>ظاهر پرتال</h3>
          <p>تم انتخابی در حساب شما ذخیره می‌شود.</p>
          <div class="theme-picker">
            <button type="button" data-theme-choice="dark">
              <span class="theme-preview dark-preview">◐</span>
              <b>حالت تاریک</b>
              <small>پیش‌فرض پیشنهادی</small>
            </button>
            <button type="button" data-theme-choice="light">
              <span class="theme-preview light-preview">☼</span>
              <b>حالت روشن</b>
              <small>نمای کلاسیک</small>
            </button>
          </div>
        </div>

        <footer class="profile-dialog-actions">
          <button type="button" class="btn btn-secondary profile-cancel">
            انصراف
          </button>
          <button type="button" class="btn btn-primary profile-save">
            ذخیره تنظیمات
          </button>
        </footer>
      </section>
    `;

    document.body.appendChild(modal);

    modal.addEventListener("click", event => {
      if (
        event.target === modal ||
        event.target.closest(".profile-close") ||
        event.target.closest(".profile-cancel")
      ) {
        closeProfileModal();
      }

      const avatarButton = event.target.closest("[data-avatar]");
      if (avatarButton) {
        modal.querySelectorAll(".avatar-option").forEach(button => {
          button.classList.toggle("selected", button === avatarButton);
        });
        preferences.avatar_id = avatarButton.dataset.avatar;
      }

      const themeButton = event.target.closest("[data-theme-choice]");
      if (themeButton) {
        modal.querySelectorAll("[data-theme-choice]").forEach(button => {
          button.classList.toggle("selected", button === themeButton);
        });
        preferences.theme = themeButton.dataset.themeChoice;
        applyTheme(preferences.theme);
      }

      if (event.target.closest(".profile-save")) {
        saveProfileAndClose();
      }
    });

    document.addEventListener("keydown", event => {
      if (event.key === "Escape") closeProfileModal();
    });
  }

  function openProfileModal() {
    createProfileModal();

    const modal = $("#profileModal");
    modal.classList.add("visible");

    modal.querySelectorAll(".avatar-option").forEach(button => {
      button.classList.toggle(
        "selected",
        button.dataset.avatar === preferences.avatar_id
      );
    });

    modal.querySelectorAll("[data-theme-choice]").forEach(button => {
      button.classList.toggle(
        "selected",
        button.dataset.themeChoice === preferences.theme
      );
    });
  }

  function closeProfileModal() {
    $("#profileModal")?.classList.remove("visible");
  }

  async function saveProfileAndClose() {
    const saveButton = $(".profile-save", $("#profileModal"));
    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = "در حال ذخیره...";
    }

    const saved = await savePreferences();

    if (saveButton) {
      saveButton.disabled = false;
      saveButton.textContent = "ذخیره تنظیمات";
    }

    if (saved) {
      applyAvatar(preferences.avatar_id);
      applyTheme(preferences.theme);
      closeProfileModal();
    }
  }

  function bindProfileButton() {
  const profileArea = $(".user-profile");
  if (!profileArea) return;

  let button = $("#profileSettingsBtn");

  if (!button) {
    button = document.createElement("button");
    button.id = "profileSettingsBtn";
    button.type = "button";
    button.className = "profile-settings-btn";
    button.title = "تنظیمات پروفایل";
    button.setAttribute("aria-label", "تنظیمات پروفایل");
    button.textContent = "⚙";

    const logout = $("#logoutBtn", profileArea);
    if (logout) {
      profileArea.insertBefore(button, logout);
    } else {
      profileArea.appendChild(button);
    }
  }

  if (button.dataset.bound !== "true") {
    button.addEventListener("click", openProfileModal);
    button.dataset.bound = "true";
  }
}

  function setupPrintButton() {
    const root = $("#modalRoot");
    if (!root) return;

    const observer = new MutationObserver(() => {
      const reader = $(".article-reader", root);
      if (!reader) return;

      const modalCard = reader.closest(".modal-card");
      if (!modalCard || $(".article-print-btn", modalCard)) return;

      const header = $(".modal-head", modalCard) || modalCard;
      const button = document.createElement("button");

      button.type = "button";
      button.className = "btn btn-secondary article-print-btn";
      button.textContent = "چاپ مقاله";

      button.addEventListener("click", () => {
        const content = reader.cloneNode(true);
        const title = $("h2", content)?.textContent || "مقاله دانشنامه";

        const printWindow = window.open("", "_blank");
        if (!printWindow) {
          toast("پنجره چاپ مسدود شده است. اجازه بازشدن پنجره را فعال کنید.", true);
          return;
        }

        printWindow.document.open();
        printWindow.document.write(`
          <!doctype html>
          <html lang="fa" dir="rtl">
          <head>
            <meta charset="utf-8">
            <title>${escapeHTML(title)}</title>
            <link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
            <style>
              *{box-sizing:border-box}
              body{font-family:Vazirmatn,Arial,sans-serif;color:#18243a;margin:0;padding:0;line-height:2.1}
              .page{max-width:850px;margin:0 auto;padding:42px 50px;position:relative}
              .brand{border-bottom:2px solid #1e4265;padding-bottom:18px;margin-bottom:28px}
              .brand strong{font-size:19px;color:#183451;letter-spacing:1px}
              .brand small{display:block;color:#73849a;font-size:10px;margin-top:4px}
              .article-reader{position:relative}
              .article-reader:after{content:"AV INTELLIGENCE";position:fixed;top:42%;left:10%;font-size:55px;font-weight:800;color:rgba(30,65,100,.045);transform:rotate(-25deg);z-index:-1;white-space:nowrap}
              h2{font-size:23px;line-height:1.8}
              h3{font-size:17px;margin-top:24px}
              p,li{font-size:12px}
              @page{size:A4;margin:15mm}
              @media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
            </style>
          </head>
          <body>
            <main class="page">
              <header class="brand">
                <strong>AV INTELLIGENCE</strong>
                <small>مرکز دانش و هوشمندی کسب‌وکار صوتی، تصویری و مارکتینگ</small>
              </header>
              <article class="article-reader">${content.innerHTML}</article>
            </main>
            <script>
              window.onload = () => {
                setTimeout(() => {
                  window.print();
                }, 500);
              };
            <\/script>
          </body>
          </html>
        `);
        printWindow.document.close();
      });

      header.appendChild(button);
    });

    observer.observe(root, {
      childList: true,
      subtree: true
    });
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
  }

  // تم تاریک را از همان ابتدا اعمال کن تا صفحه لحظه‌ای روشن نشود.
  applyTheme(localStorage.getItem("av-academy-theme") || "dark");

  document.addEventListener("DOMContentLoaded", async () => {
    bindProfileButton();
    createProfileModal();
    setupPrintButton();

    await loadPreferences();
    applyAvatar(preferences.avatar_id);
  });

  // اگر کاربر خارج شود، تنظیمات محلی پاک نمی‌شوند؛
  // ولی پس از ورود مجدد از دیتابیس خوانده خواهند شد.
  client.auth.onAuthStateChange((_event, session) => {
  currentUser = session?.user || null;

  if (currentUser) {
    setTimeout(() => {
      loadPreferences().then(() => {
        applyAvatar(preferences.avatar_id);
      });
    }, 0);
  }
});
