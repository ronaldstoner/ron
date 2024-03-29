---
layout: post
date: 2017-06-30 07:00:00 -0700
title:  "Hackmethod June 2017 - Challenges Write Up"
description: "A CTF writeup for the Hackmethod June 2017 Challenges"
---

Part of the computer security business is keeping your skills sharp and up to date. Especially within the realm of technical knowledge, sometimes knowing is not enough. Getting that raw feeling of interaction with a live system can bring things full circle, and further help to bridge that gap between knowing something and applying something. Capture The Flag (CTF) challenges in virtual server lab environments are a perfect example of maintaining while also increasing security skill sets.

## June 2017 — Silly_string

The folks over at [https://hackmethod.com/](https://hackmethod.com/) run a monthly set of challenges to help those interested in security, and June’s was pretty cool. The June set was aptly named “Silly_string” and comprised of 4 web based challenges, ranging in difficulty from beginner to advanced. All of the challenges were located on the same server and each challenge acted as a door into the next one.

The rules were as follows:

    Available Tools:

    None

    - June’s challenge will be hosted via our servers, but tools required is up to you.

    - Please DO NOT brute-force the server, it will ban your IP.

    - It is ok to scan the server. No deep scan is required as there is nothing hidden.

    - Port 22 and 8080 is all you will see.

### Challenge 1 — Website Password
> # *SHA1 the clear-text password to login to:*
> # *http://[website]:8080/*
> # *Example: HM-Chall{P@ssw0rd}*

Navigating to the website linked in the challenge description came up with a HTTP login form. Per the website, there was no need to dirbust or SQL inject, so a different way was needed to complete this challenge.

![](https://cdn-images-1.medium.com/max/2000/1*EARK5xwk5Mj4AwU6xjWhkA.png)
*The website running on TCP port 8080*

The website itself didn’t respond to many of the usual pokes and prods, so it was time to break out the scanners and see what could be found. Using a web vulnerability scanner it was determined that the website was running the Apache module **mod_negotiation**, with the **MultiViews** option enabled. This module can be abused so that file names on the server can be discovered.

![](https://cdn-images-1.medium.com/max/2000/1*A2I5lS1QZmSXQUxd1mTgDA.png)
*Scanner output showing a vulnerable module*

The Metasploit auxiliary scanner **mod_negotiation_brute** makes abusing this vulnerability easy. The scanner runs a predefined set of URLs against the server in order to discover potential file names. A file with the name of **functions.js** is found and it’s contents are checked.

![](https://cdn-images-1.medium.com/max/2000/1*SAJKh5uvGn8U_XslWYA38A.png)

![](https://cdn-images-1.medium.com/max/2000/1*7GURycseI_Ib5IM5nT8N0g.png)
*Finding the functions.js file and checking its contents*

It appears there is a commented out test function that the original developer left in the code. Inside the function **testLogin()** we can see credentials for the user **larry **encoded in **base64 **format. The **base64** password string is decoded on the command line, and the password for **larry** is revealed.

![](https://cdn-images-1.medium.com/max/2000/1*yGq4JLT6ZdaPCtmnhEb5gw.png)
*Decoding larry’s password*

The password **S7up!d_Curly!** is captured and the user can be authenticated through the web application. It appears we’ve completed the first challenge. The captured credentials are encoded according to the challenge rules and submitted for a sweet 10 points. When logging in as the **larry** user on the web application a clue for the next challenge appears.

![](https://cdn-images-1.medium.com/max/2000/1*C_3NU3dwlQajA-pnkM50Nw.png)

### Challenge 2 — Web Flag
> # Get the flag hosted on the website located here:
> # [http://[website]:8080/](http://[website]:8080/)

Per the last step in challenge 1 the goal is now to login as the **admin** user instead of **larry**. Since I had access to login as a user, I wanted to check further into how the cookies and sessions for the web server were handled. Running the **tamper_data** plugin I could tamper cookie data passed to the web server when logged in a user. The variable **admin_access **was present in the cookie, and set to **no**. Changing this value to **yes** allowed me to login as the admin user.

![](https://cdn-images-1.medium.com/max/2000/1*UPWbfsi4TZxIwl3j2PLG9g.png)

![](https://cdn-images-1.medium.com/max/2000/1*AWINjg5nNUNHdPgrrfyKuA.png)
*Changing the admin_access flag from ‘no’ to ‘yes’*

Changing the variable worked and the **admin** user was logged in. The webpage now revealed the challenge flag. It was submitted and 15 points were gained.

![](https://cdn-images-1.medium.com/max/2000/1*j_yO7BOBDoZitemVAps-DQ.png)
*Beating the challenge*

### Challenge 3 — U+002F flag.txt
> # Using the server from Web Flag : find and read flag.txt
> # SHA1 the flag.

So far all of the challenges were through the same web application on the same server. Now the Hackmethod team challenges us once more, indicating that a **flag.txt** file located somewhere on the server. Since we’ve already discovered all the files located on the outside facing web sever, this challenge seems a bit tougher. Eventually a clue is released on the Hackmethod forums stating that:
> # People are acting like they have a case of shellshock from this challenge. o_O

Aha! **Shellshock**. This should be easy! (I was wrong)

For those not familiar — Shellshock is a software bug within the Linux Bash shell that allowed remote attackers to execute commands. The result was millions of attacks that took place, with a majority happening within a few hour period of the vulnerability being disclosed. The challenge server itself seemed vulnerable to Shellshock, but it was very particular with what characters and payloads it would accept. I tried a variety of payloads and eventually found that the string:

() { test;};echo \"Content-type: text/plain\";echo;echo;{command}

would execute against a script found in the **/cgi-bin** directory called **stats**. **Stats** provided some information that was displayed on the main index page from challenge 1. The method of command delivery was a bit brutal in that the server required absolute paths for all commands entered, and the shellshock payload had to be manually modified and delivered each time a new command was to be run. This made enumerating especially hard and tedious. Thankfully a snippet of code from a RFI shell (Remote File Include), and a bit of python could save the day.

 <script src="https://gist.github.com/ronaldstoner/6d88198439c1327ffaf513a5a165b6c9.js" charset="utf-8"></script>

Using the new Shellshock shell made navigating through the file system a lot quick and easier. **/flag.txt** was found and it’s contents were revealed, thereby solving the challenge for an additional 20 points, and a clue to the next and final challenge.

![](https://cdn-images-1.medium.com/max/2000/1*8W7inxV6d8eJTO1s2xbD9w.png)
*Listing the contents of / and finding flag.txt*

![](https://cdn-images-1.medium.com/max/2000/1*4doG8XCJ7ag5Ij1yrjvQPg.png)
*Using the created Shellshock console to reveal the flag.txt*

### Challenge 4 — Zippity do dah
> # Locate the zip file on the same web server from the Web Flag challenge.
> # Do not move or copy the zip file to any other directory.
> # Find a way to get it off the server without moving it and then complete the challenge on your own environment.
> # No tools on the server will unzip or open the file.
> # GLHF

The final challenge has to do with a zipfile located somewhere on the server. Since the Shellshock console seems to be working well, it can be used to help locate the zipfile. The Linux “find” command is ran looking for all files with the .zip extension.

![](https://cdn-images-1.medium.com/max/2000/1*q_lnnxeap7BBX9yv1QL7VQ.png)
*Running “find -name '*.zip'” to determine zip file locations*

![](https://cdn-images-1.medium.com/max/2000/1*SIgcLSdT5Gyl5VTgV-Jv2w.png)
*Confirming the MD5 hash from the clue at the end of challenge 3*

**EASYFLAG.zip** is found in **/home/curly**, but the challenge instructions indicate the file should not be moved or unzipped on the server — Interesting. Unfortunately, tools like **SCP**, **netcat**, and other file transfer tools either are missing or do not work on the server. The file needs to be transferred a different way. Using **base64** a hash can be made of the file’s contents and copied as plain text.

![](https://cdn-images-1.medium.com/max/2000/1*xkkTQGWUv22iJf893TW5Vg.png)
*Creating a base64 hash of the zip file*

The contents are copied and moved to my attacking server, where base64 can be used again in order to convert the string back into a zipfile.

![](https://cdn-images-1.medium.com/max/2000/1*82QilaYz9h3V_TdD_cgTNQ.png)
*Using base64 to convert back to a zipfile and extracting the contents*

The zipfile appears to have an extra 265 bytes, causing errors during the extraction. While the file **REALFLAG.txt** does extract (and contains some interesting information), the ponderer in me wanted to fix the zipfile to see if anything else was present. Using the **zip** command the file and the extra 265 bytes can be fixed, creating a new archive.

![](https://cdn-images-1.medium.com/max/2000/1*oG6RrnC2zLlk5rGsHYDavg.png)
*Fixing and extracting the new fixed.zip file*

Extracting the fixed archive shows two text files — **EASYFLAG.txt **and **REALFLAG.txt**

![](https://cdn-images-1.medium.com/max/2000/1*W6mBWOJSoOhiDy9tCfZrEA.png)
*Great, I’ve been trolled by EASYFLAG.txt*

![](https://cdn-images-1.medium.com/max/2000/1*6DNp0VMzLRuqWt-gxKCVew.png)
*Interesting info in REALFLAG.txt*

The string located in **REALFLAG.txt** appears to be what is needed to complete the challenge. Checking the string reveals that it is not **Base64**, **MD5**, or **SHA1**, but **HEX** data. The data can be converted from **HEX **into a readable file with the **xxd** tool. Doing so reveals the flag, gets 25 points, completes Challenge 4, and ends the challenge set for June.

![](https://cdn-images-1.medium.com/max/2000/1*fpWj_aTcny4hAVOYvBjvMw.png)
*VICTORY! — Revealing the file contents and capturing the flag*


**Note**
This content was originally posted at [https://medium.com/@forwardsecrecy/hackmethod-june-2017-challenges-write-up-a92b4fcb656](https://medium.com/@forwardsecrecy/hackmethod-june-2017-challenges-write-up-a92b4fcb656) and is being re-hosted here for archival purposes.

