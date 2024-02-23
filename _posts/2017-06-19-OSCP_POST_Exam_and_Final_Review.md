---
layout: post
date: 2017-06-19 04:00 -0700
title:  "OSCP - POST Exam and Final Review"
description: "A post exam review of the OSCP certification process"
image: "https://cdn-images-1.medium.com/max/3840/1*LBc-9BHalzaMXvXziZHY6g.png"
---

![](https://cdn-images-1.medium.com/max/3840/1*LBc-9BHalzaMXvXziZHY6g.png)

In the early morning hours of a not particular Sunday morning, I stood outside on my balcony taking in the first sunlight that was just peeking through the clouds. While the crisp cool morning air wafted around my being, the neighborhood birds perched upon their trees chirped in a singsong celebration that a new day had arrived. While the current scene was calm and serene, the previous two months were comprised of extensive personal sacrifice, meticulous planning, and a hellacious tenacity.

These two extremely opposite experiences were about to collide in a 24 hour man versus machine battle of tactics and wits. I was about to take my OSCP final exam. At that moment — like something out of a heist movie — church bells started ringing in the distance signalling that 9:00 AM had arrived. I gathered my things and slowly walked back inside (in my mind to some grooving funk music). On my way back to the computer room I heard a ding on my phone indicating a new e-mail had arrived. I had received my VPN credentials and it was time to begin my exam.

 <iframe src="https://www.youtube.com/embed/-Xu4bqN3poI?si=9OVQJ3-q3sfADmGR" frameborder=0></iframe>

For those not familiar with the OSCP it’s essentially a training course and certification indicating that you can effectively use penetration testing and hacking methods to perform a security assessment. It culminates in a 24 hour exam where a student must exploit an unknown computer network and it’s servers.

There are a ton of reviews on the net about the exam and the day itself so I don’t want to re-hash too many things, but simply present my own personal experience. Everyone’s exam day seems to be different based off their situation, prior knowledge, and how effective they were in the training labs.

## The Exam

For the sake of spoilers I will not go into the exam content itself, but more the day and how it progressed. I started out the morning early with plenty of sleep, caffeinated beverages at the helm, and a cache of snacks to get me through the day. My significant other was on board and had been an immense help up to this point — allowing me to focus on studying and my exam day — I couldn’t have done it without her. For the exam itself I had a methodology ready to go, and I felt good with my attack plan and progress. I moved quickly and intelligently enumerating through systems, running exploits, and feeling the positivity until I got to hour 10 into the exam.

At that point I had what I believed to be half the network hacked and a low level user on a server I was enumerating with for privilege escalation. I knew that if I could root one more server( and maybe another low level user) that I would have enough points to pass on the exam alone.

I continued to enumerate and exploit until fatigue, cloudiness, and doubt started to creep in when my progress seemed to stagnate. I walked away to take a break and eat some much needed food (which my significant other was kind enough to make) and give my mind a break.

![](https://cdn-images-1.medium.com/max/2000/1*bmKsgbaedp2b_W98E5Z-IQ.jpeg)
*OSCP snacks*

Coming back to the exam refreshed definitely helped because I was able to root another server and low level user. The points earned for these tasks combined with my lab report and training exercises were in my mind enough to earn a passing score, but I didn’t want to leave things to chance as you are not told your score or many points your submitted report is worth.

The next 8 hours are a blur comprised of re-running various scans, enumerating as much as possible, and trying different exploits and tricks against the remaining systems. I didn’t make much progress as time bled into the morning twilight hours.

At 3:00 AM — 18 hours into the exam — I reasoned that if I could convert the low level user I had into a root account, I would secure a passing score. I made a deal with myself that I would dedicate the next 5 to 6 hours to that task alone. If I couldn’t complete the tasks by 8:00 AM — one hour before the exam end — I would abandon privilege escalation to ensure I had enough time to take any missing screenshots required for the exam report. I was exhausted, beat down, and in desperate need of a sleep but I continued to persist.

8:00 AM came and went and unfortunately I did not get privilege escalation. I knew I had enough points potentially to pass, but depending on how I was graded on the exam and lab reports it could put me into failing territory. At 8:45 AM the exam VPN connection dropped and emitted a quiet death knell. I knew my fate now rested within the hands of Offensive Security.

## Aftermath

Immediately after the exam I passed out for some much needed sleep. I planned on sleeping 2 to 4 hours during the exam, but I didn’t end up doing that. Instead I ignored all rational advice and powered through the entire 24 hours. In hindsight I should have slept instead of spending 6 hours mindlessly throwing exploit after exploit at a system for privilege escalation. My reporting and documentation was cleaned up and submitted later that night.

A few days came and went while I played mental games with myself on if I had enough passing points. I tried not to focus too much on my results, but it was definitely a mental game just like everything else in the training course. The next morning I woke up to an email notification indicating that I had fulfilled all of the requirements, had enough points, and had passed!

The SO and I proceeded to celebrate and we celebrated hard. Copious amounts of ahi tuna, coconut shrimp, and lots of alcoholic drinks were on the menu. The entire course was time, money, and resources well spent.

## Tips for future exam takers

The following were some things I noted during the exam.

**Enumerate**

You’ve heard it before and I can’t tell you much time it will save you. Why bother wasting hours in failed attempt after attempt executing 32-bit exploits against a 64-bit architecture? Spend that time more wisely. Identify your target, profile your target, and develop an intelligent attack plan.

**Organize**

If you’re anything like me and you’ve been going through the lab environment and associated training exercises, chances are your Kali virtual machine desktop is a mess. Take some time before the exam to re-organize and clean up your work space. This includes your physical computer desk as well. It’s going to help to not have to sift through a bunch of previous exploits and junk while you’re in the exam. Having said that, make sure you have your collection of “go-to” scripts and exploits organized and ready. For me I kept a lot of things in folders residing in /var/www/html just in case I needed to access and serve them up remotely.

**Manage your time**

One mistake I made in planning was that the exam was 24 hours and would run from Sunday 9:00 AM to Monday 9:00 AM. I was surprised when 8:45 AM came and my exam VPN connection terminated. I was so close on privilege escalation that the last 15 minutes could have helped me. I planned on utilizing those last precious minutes, but when the exam ended I remembered that it’s **23 hours and 45 minutes**, NOT a full 24 hours.

One other point on this topic is to make sure you have a reporting template ready to go and an easy way to import notes prior to exam day. I can’t tell you how much time it will consume to generate report content if you’re not using an automated system. Even WITH an automated system things like formatting, margins, line breaks, image sizes, fonts, etc. were something I knew I had to tweak, but grossly underestimated how much time it would take me. I wanted my report to reflect my professionalism which means formatting was important to me.

**Enjoy It**

The experience of the training and exam can be frustrating, fulfilling, educational, unforgiving, and unique. No other training I’ve completed comes anywhere close to the level of satisfaction and personal pride I took from completing this course. While you may be eager to pass and achieve your certification, make sure you really enjoy your time. You will miss the one of a kind lab and exam networks. It’s a bittersweet feeling, but now it’s time to keep moving forward and get to work.

**Note**
This content was originally posted at [https://medium.com/@forwardsecrecy/oscp-post-exam-and-final-review-448e51bf7dae](https://medium.com/@forwardsecrecy/oscp-post-exam-and-final-review-448e51bf7dae) and is being re-hosted here for archival purposes.