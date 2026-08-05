/** Revolut entry points that open the native app on phones, web app on desktop. */

export function isPhoneClient() {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

/** Home / main app — phones get the app universal link, desktops the web app. */
export function revolutHomeUrl() {
  return isPhoneClient() ? "https://revolut.com/app" : "https://app.revolut.com/";
}

/** Invest tab — same host strategy; in-app navigation is one tap from home. */
export function revolutInvestUrl() {
  return isPhoneClient() ? "https://revolut.com/app" : "https://app.revolut.com/";
}
