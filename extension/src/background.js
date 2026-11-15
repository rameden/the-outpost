// Barnstorm, the browser extension: what happens when its button is clicked (or Alt+Shift+B).
//
// It asks for no standing access to anything. A click gives it the page you're on, once
// ("activeTab"), and it puts the game there: a stylesheet for the page (how a shot piece of
// it is hidden), and the game itself (content.js). Clicked again on a page where the game is
// already up, the same script pauses it, or resumes it: it knows which.

// Has this page had the game's stylesheet already? (It only needs it once, however many games.)
const styled = () => {
  const had = document.documentElement.hasAttribute("data-barnstorm-styled");
  document.documentElement.setAttribute("data-barnstorm-styled", "");
  return had;
};

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id == null) return;
  const target = { tabId: tab.id };
  try {
    const [{ result: had }] = await chrome.scripting.executeScript({ target, func: styled });
    if (!had) await chrome.scripting.insertCSS({ target, files: ["page.css"] });
    await chrome.scripting.executeScript({ target, files: ["content.js"] });
  } catch {
    // The browser keeps extensions off some pages (its own, the extension store, a PDF): say so on the button, briefly.
    await chrome.action.setBadgeBackgroundColor({ ...target, color: "#d8402f" });
    await chrome.action.setBadgeText({ ...target, text: "no" });
    await chrome.action.setTitle({ ...target, title: "Barnstorm can't run on this page: the browser doesn't let extensions in here." });
    setTimeout(() => chrome.action.setBadgeText({ ...target, text: "" }).catch(() => {}), 2500);
  }
});
