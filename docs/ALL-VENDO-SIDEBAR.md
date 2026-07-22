# ALL VENDO Collapsible Sidebar — Integration Snippet

Kung ang main portal mo sa `jmtechsolution.cloud` ay hiwalay na app, idagdag ang code na ito para maging collapsible ang ALL VENDO menu.

## HTML Structure

```html
<!-- Sa sidebar, palitan ang static items ng: -->
<button type="button" class="nav-btn" id="btn-allvendo" aria-expanded="false">
  ALL VENDO <span id="chevron-allvendo">▸</span>
</button>
<div id="children-allvendo" hidden>
  <button type="button" class="nav-btn nav-child" data-page="empty-bottle">Empty Bottle</button>
  <button type="button" class="nav-btn nav-child" data-page="cloud-hotspot">Cloud Hotspot</button>
</div>
```

## CSS

```css
#children-allvendo[hidden] {
  display: none !important;
}
#children-allvendo.open {
  display: block;
  padding-left: 16px;
}
```

## JavaScript

```javascript
document.getElementById('btn-allvendo').addEventListener('click', function () {
  const children = document.getElementById('children-allvendo');
  const chevron = document.getElementById('chevron-allvendo');
  const isOpen = !children.hidden;

  if (isOpen) {
    children.hidden = true;
    children.classList.remove('open');
    this.setAttribute('aria-expanded', 'false');
    chevron.textContent = '▸';
  } else {
    children.hidden = false;
    children.classList.add('open');
    this.setAttribute('aria-expanded', 'true');
    chevron.textContent = '▾';
  }
});
```

## JM-WiFi-cloud Admin Portal

Ang built-in admin portal (`/admin/`) ay may collapsible menu na. I-deploy ang server at buksan:

```
https://jmwifi.jmtechsolution.cloud/admin/
```
