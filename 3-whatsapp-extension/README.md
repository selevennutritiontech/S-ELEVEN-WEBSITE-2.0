# S-ELEVEN WhatsApp Helper (browser extension)

**What it fixes:** without this helper, a web page cannot control a browser tab it did not open, so every *Share* or *Chat on WhatsApp*
in the portal opens a new tab. With the helper installed, the portal asks the helper to find the WhatsApp Web tab you already have
open and signed in, and the chat goes into **that** tab (it is brought to the front). A new tab is opened only if no WhatsApp Web tab exists.
The helper only does this; it never reads your chats or the portal data, and it accepts only WhatsApp Web chat links.

Install once per browser (about a minute):

## Chrome, Edge, Brave (Windows, Mac, Linux)
1. Open `chrome://extensions` (Edge: `edge://extensions`). Switch **Developer mode** on.
2. Press **Load unpacked** and choose this folder (`3-whatsapp-extension`).
3. If you open the portal as a file from your computer (not from a website or localhost), open the extension's **Details** and switch on
   **Allow access to file URLs**.
4. Open the portal > **WhatsApp**: it should say the helper is installed. Open WhatsApp Web in a tab and sign in once (scan the QR code).
   From then on every Share and every Chat uses that tab.

## Safari (Mac)
Safari needs the extension wrapped as a Safari app once (free, needs Xcode from the Mac App Store):
1. In Terminal run: `xcrun safari-web-extension-converter /path/to/3-whatsapp-extension --app-name "S-ELEVEN WhatsApp Helper"`
2. Xcode opens: press **Run** (the play button). If asked, in Safari choose **Settings > Advanced > Show features for web developers**,
   then **Develop > Allow Unsigned Extensions**.
3. Safari > **Settings > Extensions**: tick **S-ELEVEN WhatsApp Helper** and allow it on the portal's website.
4. Optional: to use it everywhere permanently, sign the app with your Apple developer account.
Safari on **iPhone/iPad** cannot run this helper, and does not need it: chats open the WhatsApp app directly.

## Other options (no install)
* **WhatsApp Desktop app:** in the portal > WhatsApp choose "Open chats in the WhatsApp Desktop app". Chats go to the signed-in app, no tab at all.
* Without the helper, the portal keeps one WhatsApp tab that it opened itself and reuses it as long as the portal page is not reloaded.
