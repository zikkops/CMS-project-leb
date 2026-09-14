// One photograph per demo dish — the pictures on the till's menu tiles.
//
// Keyed by the demo menu's item slug (MENU in seed-demo.mjs), with the dish's
// name alongside so a demo whose items were created by hand still matches.
// Used by seed-demo.mjs for a fresh demo and by seed-menu-images.mjs for one
// that already exists.
//
// Every photo below was downloaded and looked at on 14 Sep 2026 to check it
// shows its dish, not just that the URL answers 200 — a brand-name can was
// swapped for an unbranded glass, and a first "Americano" that was a picture
// of an espresso tamper was replaced. All are plain `photo-` ids on
// images.unsplash.com, free content; `premium_photo-` ids are Unsplash+
// subscription material and must never be hotlinked here. None is reused from
// the retail products, one distinct picture per item as elsewhere in the seed.

export const MENU_ITEM_PHOTOS = {
  espresso:        { name: 'Espresso',         photo: 'photo-1510707577719-ae7c14805e3a' },
  americano:       { name: 'Americano',        photo: 'photo-1521302080334-4bebac2763a6' },
  cappuccino:      { name: 'Cappuccino',       photo: 'photo-1572442388796-11668a67e53d' },
  latte:           { name: 'Latte',            photo: 'photo-1561882468-9110e03e0f78' },
  tea:             { name: 'Pot of Tea',       photo: 'photo-1576092768241-dec231879fc3' },
  'iced-latte':    { name: 'Iced Latte',       photo: 'photo-1517701604599-bb29b565090c' },
  lemonade:        { name: 'Lemonade',         photo: 'photo-1621263764928-df1444c5e859' },
  'soft-drink':    { name: 'Soft Drink',       photo: 'photo-1581636625402-29b2a704ef13' },
  sparkling:       { name: 'Sparkling Water',  photo: 'photo-1559839914-17aae19cec71' },
  'club-sandwich': { name: 'Club Sandwich',    photo: 'photo-1528735602780-2552fd46c7af' },
  margherita:      { name: 'Margherita Pizza', photo: 'photo-1574071318508-1cdbab80d002' },
  'caesar-salad':  { name: 'Caesar Salad',     photo: 'photo-1550304943-4f24f54ddde9' },
  fries:           { name: 'Fries',            photo: 'photo-1573080496219-bb080dd4f877' },
  cheesecake:      { name: 'Cheesecake',       photo: 'photo-1533134242443-d4fd215305ad' },
  brownie:         { name: 'Brownie',          photo: 'photo-1606313564200-e75d5e30476c' },
  cookie:          { name: 'Cookie',           photo: 'photo-1499636136210-6f4ee915583e' },
}

/** The same crop the rest of the seed uses for product photos. */
export const menuPhotoUrl = photo =>
  `https://images.unsplash.com/${photo}?auto=format&q=70&w=800&h=600&fit=crop`
