# Photo set A: AI-generated photorealistic test images (Flow), not real photos

The set in `photo-sets/A/` was generated with Google Flow (Nano Banana): checkout images first, each return image from its checkout image as the reference, with only the listed damage added. The watermark corner was cropped off. Rejected candidates are in `photo-sets/A/_candidates/`. They are not real photos; the result below is not accuracy on real photos. The shooting checklist below still applies if you replace them with real ones.

Goal: one real check-out and check-in photo pair for each of the six zones, run through the same `compareZone()` the app uses, with the local Claude Code account (Sonnet, never an API key), and the result recorded next to what you know is true. This is one set of six zones, not a detection rate. Do not quote it as one.

## Folder and one command

Put the 12 photos and `expected.json` in `photo-sets/A/` (this folder, from the app root). Then:

```
npm run photoset:check   # only checks that the folder is complete, no model call
npm run photoset:a       # seeds the set: runs six zones through account-mode Sonnet, writes photo-sets/A/results.json
```

`photoset:a` refuses to start while the folder is incomplete and lists what is missing. It sets `LLM_BACKEND=account`, empties `ANTHROPIC_API_KEY`, and makes no PayPal call. After it runs, copy the numbers into README (honest-limits section) and VERIFY row V15, and upload the same files through the staff zone card (`POST /api/s/:sid/photos/:zone`) if you want to show the real photos in the app.

## File names (exact)

Six zones, two shots each, JPEG or PNG, lowercase:

| Zone | Check-out file | Return file |
|---|---|---|
| Body front | `body_front_checkout.jpg` | `body_front_return.jpg` |
| Top plate | `top_plate_checkout.jpg` | `top_plate_return.jpg` |
| Rear LCD | `rear_lcd_checkout.jpg` | `rear_lcd_return.jpg` |
| Lens front element | `lens_front_checkout.jpg` | `lens_front_return.jpg` |
| Lens barrel | `lens_barrel_checkout.jpg` | `lens_barrel_return.jpg` |
| Lens mount | `lens_mount_checkout.jpg` | `lens_mount_return.jpg` |

Optional close-up of a suspect spot: `<zone>_closeup.jpg` (kept with the set; the app's close-up step uses it).

## Shooting checklist

Use gear you own (a spare body and a lens). Do not damage rented gear.

1. Same body, same lens, same spot for both shots. Check-out shot first, then do the damage steps below, then the return shot.
2. Camera: a phone or camera on a tripod or a fixed stack of books, same distance for both shots. Mark the table edge with tape so the return shot repeats the framing. A small shift is fine (the model sees both images), a different distance is not.
3. Angles, one per zone, straight on unless noted:
   - Body front: camera on the lens axis, body with the lens off, mount side facing the camera.
   - Top plate: from above, 90 degrees to the dial surface.
   - Rear LCD: straight on, screen off, so the glass shows scratches.
   - Lens front element: straight on along the lens axis, cap off.
   - Lens barrel: from the side, focus ring in the middle of the frame.
   - Lens mount: straight on into the mount, lens off, body cap off.
4. Lighting: one soft window light from the left, no flash, no direct sun, same time of day for both shots. Keep the camera exposure locked (same ISO, speed, aperture, or the phone's AE/AF lock). Do not move the light between the pair.
5. Sharpness: tap to focus on the zone, no motion blur, no digital zoom. Fill about 70 percent of the frame with the zone.
6. Export: JPEG, long edge 1600 px, quality 85, under 4 MB each. No filters, no cropping after the shot, keep EXIF.

## Which damage to show

The set mirrors the demo story so the recorded comparison can be put next to it.

| Zone | Between check-out and return | `expected.json` |
|---|---|---|
| Top plate | A new thin scratch (on your own spare body, or a hairline made on a removable matte film stuck on the plate) | `damage: true`, box around the scratch |
| Lens mount | A small real dent or ding on the mount rim of a spare lens or body cap ring, or if you cannot make one, leave this zone clean and set `damage: false` | `damage: true` with a box, or `false` |
| Lens barrel | An old mark that is already visible in the check-out shot and unchanged in the return shot | `damage: false`, `preExisting: true` |
| Body front, Rear LCD, Lens front element | No change. Wipe the lens and the screen of fingerprints before both shots so dust is the same | `damage: false` |

## expected.json

What you know is true, per zone, written before you look at the model result. Box is in pixels of the return photo (`x`, `y` = top left, `w`, `h`). See `photo-sets/A/expected.example.json`.

```
{
  "body_front": { "damage": false },
  "top_plate": { "damage": true, "kind": "scratch", "box": { "x": 900, "y": 640, "w": 260, "h": 70 } },
  "rear_lcd": { "damage": false },
  "lens_front": { "damage": false },
  "lens_barrel": { "damage": false, "preExisting": true },
  "lens_mount": { "damage": true, "kind": "dent", "box": { "x": 700, "y": 520, "w": 180, "h": 140 } }
}
```

All six zones are required.

## What results.json holds

Per zone: expected truth, Claude's verdict, confidence, rate code, whether its box covers the centre of your box, its note, and an outcome of `match`, `miss`, `false_alarm`, `uncertain` or `unreadable`. `uncertain` is its own bucket because the product sends those to a person. If the model misses the top plate scratch, report the miss as it is and change `INSPECT_PROMPT` or the vision system prompt, not the scoring.
