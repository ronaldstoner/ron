---
layout: post
date: 2023-10-08 12:00 -0700
title:  "SelfHash: Ensuring the Integrity of Your Python Scripts"
description: "SelfHash - a Python package that enables your scripts to hash and verify their own integrity."
image: "https://raw.githubusercontent.com/ronaldstoner/ron/gh-pages/images/SelfHash.png"
---

<p align="center">
  <img src="https://raw.githubusercontent.com/ronaldstoner/ron/gh-pages/images/SelfHash.png" alt="" width="300"> 
</p>

I'm excited to announce the initial public release of SelfHash 0.1.1 that I worked on in October of 2023. SelfHash was designed to add an extra layer of security and verification to your Python scripts before execution - ensuring that it has not been tampered with.

## Problem
Consider the following scenario: You manage a mission-critical Python script. It's a piece of code that your organization heavily relies on. What if someone with malicious intentions gets access to your server and alters the script? (You have bigger problems to handle if this is the case, but stick with me for this scenario). How would you know if your once trusted Python script has been manipulated?

Traditional antivirus software might not catch such changes especially if they are subtle and do not introduce known malicious code patterns. Periodic manual code inspection is not always feasible due to the dynamic nature of development environment. Adding a hash to a file and then hashing it results in a Chicken/Egg problem.

How can one ensure the integrity of their Python scripts?

## Solution: SelfHash
Enter SelfHash - a Python package that enables your scripts to verify their own integrity. SelfHash uses the SHA-256 hashing algorithm to compute a hash of your code and then compares it with a known good hash. If the hashes match then the script is considered verified and continues execution. If the hashes do not match the script immediately exits preventing the execution of potentially tampered code.

Here's a simple example of how you can use SelfHash:

 ```python 
# Hash: INSERT_HASH_HERE
import selfhash

hasher = selfhash.SelfHash(bypass_salt=False)
hasher.hash(__file__)
```

When you run your script for the first time using SelfHash it will generate a SHA-256 hash of your code. A hash is a fixed-size numerical or alphanumeric value computed from an input of any size, in this context the input being your source code. You then replace `INSERT_HASH_HERE` with this generated hash. This hash serves as the "known good" hash that will be used for verification in all subsequent runs. If any part of the source code is changed then a new hash is computed and will fail when checked against the "known good" hash. 

## Adding a Salt/Passphrase for Extra Security
SelfHash also allows you to add a salt or a passphrase to your hash calculation providing an extra layer of security as I realize simple hashing alone may not be enough security wise. This salt/passphrase is a secret component that makes your hash unique. Even if someone else has the exact same script code, they won't be able to generate the same hash unless they also know your salt/passphrase.

```python
# Hash: INSERT_HASH_HERE
import selfhash

hasher = selfhash.SelfHash(bypass_salt=False)
hasher.hash(__file__)
```
During the execution, SelfHash will prompt you to enter a salt/passphrase. If you choose not to provide one, simply press Enter.

## Bypassing the Salt/Passphrase
There might be some cases where you want to bypass the salt/passphrase prompt, such as in automated environments where user input is not possible. SelfHash was created in a way that allows you to do this by setting the `bypass_salt` parameter to `True` when creating an instance of the SelfHash class:

```python
# Hash: INSERT_HASH_HERE
import selfhash

hasher = selfhash.SelfHash(bypass_salt=True)
hasher.hash(__file__)
```
## A Piece of the Puzzle
While SelfHash is a powerful tool for ensuring the integrity of your Python scripts, it's important to remember that it should not be used in isolation. SelfHash is a part of a holistic approach to security, not a standalone solution. It is designed to complement, not replace, other security measures.

There are several potential security concerns to be aware of when using SelfHash:

  - Memory Exposure: The salt/passphrase may remain in memory throughout script execution.
  - Hash Collisions: Very unlikely, but theoretically possible (about 1 in 2^256)
  - Lack of Encryption: SelfHash verifies code integrity but does not encrypt source code
  - Bypassing Salt: The bypass_salt feature while useful can decrease security 
  - External Libraries: Vulnerabilities in hashlib and getpass may affect SelfHash

## Conclusion
In today's world where code integrity is of paramount importance SelfHash strives to offer a simple and effective solution to ensure your Python scripts have not been tampered with. While it should be a part of a comprehensive security strategy and not relied upon as the sole security measure, SelfHash provides an extra layer of security that can help enhance peace of mind. 

I hope you find SelfHash useful and look forward to your feedback. Please feel free to contribute to the project on the GitHub page located at https://github.com/ronaldstoner/selfhash-python
