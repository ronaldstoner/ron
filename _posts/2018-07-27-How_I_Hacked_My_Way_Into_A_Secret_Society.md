---
layout: post
date: 2018-07-27 01:00:00 -0700
title:  "How I Hacked My Way Into A Secret Society"
description: "How I Hacked My Way Into A Secret Society (and how you can too!)"
---

The concept of blockchain technology and crypto-currency fascinates me. It’s not just the technical marvels and feats, the fact that true consensus can be achieved through a protocol, or that the idea itself provides utilitarian and disruptive properties. Blockchain technology is just coooooool, like *“Fonzie cool”*.

![Ayyyyyyyyyyyyy](https://cdn-images-1.medium.com/max/2000/1*3zgHsS2mJ29pfbY1RE3TXQ.png)

Some applications on blockchain that have had that “cool factor” over the past few years have ranged from online dice games and casinos, people placing marriage certificates into an immutable blockchain transaction, RPG games consisting of battling robots, and most recently — the collecting of rare CryptoKittes (yes, it’s a thing). When I was told by a friend recently about a *mysterious* Ethereum smart contract, I felt the cool factor kick in and my interest immediately piqued. Enter: **theCyber**.

**theCyber** is a secret society whose only way to enter is to hack a series of Ethereum smart contracts. For those who don’t delve too deep into blockchain technology, Ethereum is a “blockchain-based distributed computing platform” which essentially means it’s one giant computer that runs code that has been programmed into a “smart contract”. The smart contract sits and waits for a valid Ethereum transaction to hit its address, at which point the transaction and its associated data are verified and processed.

**theCyber Contract ID:**0xbB902569a997D657e8D10B82Ce0ec5A5983C8c7C

**Etherscan Link:** [https://etherscan.io/address/gatekeepertwo.thecyber.eth#code](https://etherscan.io/address/gatekeepertwo.thecyber.eth#code)

**theCyber** included some contracts, including three “gate-keepers” with no provided context, other than some publicly available code.

![One of theCyber’s smart contracts](https://cdn-images-1.medium.com/max/4548/1*bEPZ8n1fs4QY0f_Tw2cWmQ.png)

It wasn’t until after I heard of the challenge, that I learned in early 2018 certain members of Ethereum and crypto-current based forums were sent a PGP encrypted email containing an invitation to a brand new decentralized secret society. This email contained a 4 word passphrase comprised of 32 bytes. Apparently, this password was needed in conjunction with some Ethereum smart contracts in order to make something happen. Unfortunately, I didn’t receive the e-mail, but I knew I wanted in the secret society.

![Open sesame!](https://cdn-images-1.medium.com/max/2000/1*GomLqHl4e6yfRaLkExOSzw.jpeg)

I started looking at the smart contracts with friends, people I worked with, and other crypto experts to determine what was needed to complete the challenge. It seemed you needed to announce the password (send it to a smart contract) as a data field, progress through the smart contracts to get a “gate key”, and if the information you provided was correct, you would verify as someone who was invited to the society. Easy peasy! (but not really…)

Through a lot of analysis, math operations, and [insert secret sauce here] the contracts were able to be decoded. I don’t want to spoil the challenge, so those specific details will not be available. Since I had 50% of what I needed (the contracts were solved), all I had to do now was tackle the password.

I spent some time trolling through forum posts, Reddit, and other corners of the internet looking for password strings that people may have posted. **theCyber** smart contract itself had a function that let you check to see if a password was used. Little did I know, that the creator of the contract was giving out unused password strings if you directly messaged them. I could have taken that route, but in the hacker mindset, I did one better.

![Ya know, usual hacker stuff…](https://cdn-images-1.medium.com/max/2000/1*m110FZ4yZZj0JDEjzgFdug.jpeg)

In the above paragraph, I mentioned that one had to encapsulate the password in a data field within a transaction broadcast to the smart contract. What people didn’t realize though, is that those that were invited to the challenge were trying a variety of things to figure out and reverse engineer the contracts. These attempts included sending the password to the smart contract in a variety of ways, like a failed transaction. These were failed transactions that were broadcast onto the Ethereum blockchain. A blockchain whose records were totally public. A public blockchain, where all transactions can be looked up and are public, and all data associated with the those transactions can be viewed and reversed by anyone…at any time…at any place.

![Reversing failed transaction data to get potential passwords that were attempted](https://cdn-images-1.medium.com/max/2000/1*64zX-1rmVBA37-sBAIydsQ.png)

If you didn’t get the heavy hint above, I acted in true hacker fashion and looked up password strings people had tried previously. Eventually, I landed on a password string that was valid and attempted, but ultimately was not accepted due to the lack of the gate-keeper contracts being solved. Since I had previously solved the gate-keeper contracts, I now had both pieces needed to enter the secret society. I submitted the requested data, and saw that my Ethereum wallet address was now added as a member! My apologies to the person whose password string I used — I owe you a pint.

This one was a huge personal win, because I originally started with nothing, and in true hacker fashion was able to infiltrate my way in to the first secret society on the Ethereum blockchain. Shout out to those who remain nameless that collaborated on me with this. I’ll see you in the top secret meetings.

As of this posting there was **102** of the **128** entrants needed to activate the secret society contract. You still have time (but not much) to join something new, innovative, and also be Fonzie.

**Note**
This content was originally posted at [https://medium.com/@forwardsecrecy/how-i-hacked-my-way-into-a-secret-society-80cc8bc8bf72](https://medium.com/@forwardsecrecy/how-i-hacked-my-way-into-a-secret-society-80cc8bc8bf72) and is being re-hosted here for archival purposes.

