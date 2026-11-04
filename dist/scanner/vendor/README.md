CameraScanner and scanImage are retained from Mundus-Apps Macro Tracker, commit
802682f76b0d467113ff9bdd3a71b5327d9225b6. The only change to camera.mjs is resolving
the bundled decoder relative to its module URL so it works from every Ace Tools page.
Mundus Apps source and deployment are unchanged.

The same published @zxing/browser 0.1.5 bundle, its @zxing/library 0.21.3 dependency,
and both licenses are bundled here. The scanner never loads a remote decoder script.
Camera frames and uploaded photos are decoded on-device; only barcode digits go to lookup.
