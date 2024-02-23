---
layout: post
date: 2019-06-02 02:00:00 -0700
title:  "The Next Electric Scooter You Ride Could Be Hacked"
description: "The Next Electric Scooter You Ride Could Be Hacked"
---

![](https://cdn-images-1.medium.com/max/2296/1*8pawO3MwBoN-7m7_tZ2pug.jpeg)


**Preface:** I do not advocate anyone does anything illegal. Hack on your own hardware.

Personal electronic transportation devices are everywhere now, and they are *fuuuuuun*. Private consumers are using them to replace their daily commutes, new distances are being achieved for the displaced, and companies like Bird, Lime, and Spin are littering the streets with on-demand rental opportunities.

With new technology comes new security vulnerabilities, and with new security vulnerabilities comes new hacks. Scooters are no exception. Hackers and the DIY crowd have achieved new levels in scooter hacking, 3D parts printing, and custom firmware creation. There has been a movement by hackers recently to “liberate” the on-demand scooters that populate the streets. Be it ethical, financial, or essential — the needs of the few are many.

### Our Test Subject

![](https://cdn-images-1.medium.com/max/2000/1*EmRq5vflveBxNixCJxhkRg.jpeg)
*The Xiaomi Mi M365*

The Xiaomi Mi M365 Electric Scooter provides an 8.6 Miles long-range battery and can reach a speed of up to 15.5 MPH. They can be purchased new for around $400 USD from the manufacturer, or from your favorite web shopping store that begins with the letter ‘A’. It also happens to be original model that Bird was using with some slight hardware modifications. The “liberation” process for this scooter is extremely similar to an upgrade I did to a personal scooter of mine — replacing an original dashboard with a newly upgraded PRO model version. While a PRO version board is not needed for the hack, it does add things like a digital speedometer and faster speeds.

### Security Hole #1: Open Bluetooth Communication

The M365 (and various other models) allow the rider to use official and third party apps over Bluetooth to monitor things like battery level and speed. This differs from other transport devices like the **OneWheel** which require a rider to be fully stopped in order to connect over Bluetooth. While Bluetooth pairing can be required to have the official apps communicate with the scooter, no PIN or authentication was required to connect using third party apps and firmware utilities. Various scooters in public places could be connected to and controlled by an attacker. This leads us to…

### **Security Hole #2: Writing Your Own Firmware**

The scooter itself uses 3 separate systems to make it’s magic happen. The **BLE** handles Bluetooth LE communication, a **BMS** manages the Battery Management System, and a **DRV** is the manufacturer firmware which controls the scooter and retains all it’s configuration.

No further authentication was required after connecting over open Bluetooth to write a custom firmware. Sites like [https://m365.botox.bz/](https://m365.botox.bz/) allow a user to set their own values such as removing speed restrictions and hard limits, manipulating cruise control values, allow higher voltage battery swaps, and other cool power user type features. It only takes seconds after cooking up a new .bin file to replace the stock firmware.

### Security Hole #3: No Hardware Security

![](https://cdn-images-1.medium.com/max/2002/1*91HmMWFkJhjhIjFJyE6fJw.jpeg)
*A replacement dashboard*

The upgrade I performed (and part of the “liberation” process as it has been described to me) is to swap out the entire dashboard of the scooter. The dashboard includes the **BLE** Bluetooth controller and acts as the brain and controller of the scooter. Replacements are EXTREMELY RARE (ahem) and can be had from your favorite internet hardware re-seller or in some cases — Walmart (I don’t advocate this). Swapping out the dashboard takes only a few minutes, and new firmware can instantly be flashed to it via an Android phone or tablet. Once the dashboard is swapped out and a new firmware is written, the scooter is effectively in control of the new owner.

![](https://cdn-images-1.medium.com/max/2000/1*JWE-1WyVauuBox2oIdbM1A@2x.jpeg)
*Performing my own board swap*

### **Brake-ing it all down**

While all 3 security holes above seem innocent enough in their own right, putting them together allows an attack to control any scooter they want. Controlling the Bluetooth stack, replacing the board, and flashing your own custom firmware removes the scooter from any control within it’s own native system. As a side benefit, it allows consumers to experience new software and hardware features they may not have previously. I’ve heard rumors of hackers taking over scooters and disabling the brakes causing endless rides for the consumer, or bricking scooters entirely with bad flashes due to anarchistic reasons. I’ve also seen homeless and alleyway entrepreneurs “liberating” scooters and flipping them for cash. Police and city impound auctions have been a hot-spot for Version 1 scooters looking for new life for only around $25 USD and a few spare minutes of your time.

### **Caveat Emptor**

Scooter companies are invested in their product and, as such, there does exist other security mechanisms such as GPS tracking, SIM cards, and serial number identification. One model from a competing company wires their higher voltage dashboard directly into the battery using an aftermarket cable. If you attempt to do a dashboard swap incorrectly on these models you may injure yourself and/or blow up the board and damage the scooter or yourself.

Since the first draft of this article, various upgraded scooter models and firmware have been released. Bird seems to be using newer models from Segway and others with external battery packs as opposed to one underneath the main deck. While it is not impossible to hack the latest models, measures have been taken to fix the holes mentioned above. Version 1.5.1 of the official M365 firmware encrypts Bluetooth communication and while this is a step in the right direction, it does remove third party application support.

Personal transport devices will continue to permeate our lives and security mindset should be permeating it as well. I’m hopeful that as the momentum grows so will the security model for these important pieces of tech in our lives. Cars, scooters, electric skateboards, powered unicycles, hover shoes, and even drones are all at risk and need to be looked at with a malicious eye. We need to do better. Would you trust your life to a scooter at 18 miles per hour if you knew I was controlling it all the time on my phone?

**Note**
This content was originally posted at [https://medium.com/@forwardsecrecy/the-next-electric-scooter-you-ride-could-be-hacked-7cba3dcc64a4](https://medium.com/@forwardsecrecy/the-next-electric-scooter-you-ride-could-be-hacked-7cba3dcc64a4) and is being re-hosted here for archival purposes.

