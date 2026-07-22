# ALL VENDO Button — Sidebar Integration

Ang **ALL VENDO** ay simpleng nav button na diretso sa ALL VENDO page.

## HTML (sidebar)

```html
<button type="button" class="nav-btn" data-view="allvendo">
  ALL VENDO
</button>
```

## JavaScript

```javascript
document.querySelector('[data-view="allvendo"]').addEventListener('click', function () {
  showView('allvendo'); // or your page navigation function
});
```

## JM-WiFi-cloud Admin Portal

```
https://jmwifi.jmtechsolution.cloud/admin/#allvendo
```

Empty Bottle at Cloud Hotspot — nasa loob ng ALL VENDO page bilang cards, hindi sa sidebar (pwede idagdag ulit later).
