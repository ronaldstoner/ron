---
layout: post
date: 2024-05-20 00:00 -0700
title:  "I Gained 1 Million Followers in 24 Hours"
description: "Gaming the social media follower count"
image: "https://raw.githubusercontent.com/ronaldstoner/ron/gh-pages/images/nostr-number1.png"
---

Social media dominance often translates to influence and power. I recently embarked on an exercise to expose the fragility and manipulability of these platforms. My mission was to gain 1 million followers on Nostr within 24 hours. 

![](https://raw.githubusercontent.com/ronaldstoner/ron/gh-pages/images/nostr-number1.png)

Here’s how it all worked.

## The Experiment

### Nostr

Nostr is an innovative alternative to traditional social media platforms. In centrally hosted social media a single entity controls the servers and infrastructure whereas Nostr gives you complete control over your posts and content. You can also manage the transmission pipeline and the servers through which your data flows if one chooses.

Nostr uses public and private key pairs for identity, digital signing, and account authorization. This method is known as a cryptographic "something you have" in security. Your private key (think of a key to a lock or even your password) remains confidential and in your control, while your public key (the lock or similarly your email address) can be shared for others to interact with you securely. Cryptographic processes and math help to hash, digitally sign, and encode your messages. This means that others cannot tamper with them or impersonate you as easily. 

For those interested in the technical details, each Nostr event consists of a series of JSON-formatted values. These include information about the post's metadata, its content, and a Schnorr digital signature. You can read more about it at [https://github.com/nostr-protocol/nips/blob/master/01.md](https://github.com/nostr-protocol/nips/blob/master/01.md) 
.

### Sybil Attack

A Sybil attack is like a sneaky trick where someone pretends to be many different people on the internet in order to cause trouble. Imagine you're playing a game with your friends and one of the players secretly makes a lot of fake accounts to join the game. They use these fake accounts to cheat, make unfair rules, or mess up the game for everyone else. 

In the same way, during a Sybil attack a person creates many fake identities on the internet to try to take control or disrupt things. It's not a nice thing to do and it can make it hard for people to trust what they see and hear on the internet. So that's exactly what we're going to do.

### The Approach

I like taking advantages of existing features in products. I've always been keen on using the system functionality against itself. While what I did was nothing novel, it was achievable none-the-less. I knew from other scripts I worked on prior that generating over 1 million keypairs locally on a CPU and broadcasting them into the Nostr network was both cheap and easy, but would take some time to broadcast the follow event payload. In a world of cheap, easy, and fast you only get two out of the three. 

The exercise was accomplished with less than 200 lines of code. However, I won't share that here as I don't want others to replicate my actions.

The script I designed automates the creation of new follower accounts and the sending of follow requests. Here’s a simplified overview:

1. **Generate Keys**: Create new public and private key pairs.
2. **Sign Events**: Sign follower events using the private key.
3. **Send Events**: Send these signed events to multiple Nostr relays, effectively following the target account.
4. **Secret Sauce**: Every script needs a secret sauce for that "je ne sais quoi" feeling.

Initially this worked well - but wasn't as fast as I wanted. I knew we could do better. I added several relays into a "relay array" and revised my code to iterate through each. Things improved, reaching around 13 follow requests per second.

- **Followers per second**: 13
- **Seconds per minute**: 60
- **Minutes per hour**: 60

Total new followers per hour = 13 * 60 * 60 ≈ 46,800

To hit 1 million followers in 24 hours: 1,000,000 / 46,800 ≈ 21.37 hours

One can see that under perfect network conditions, this feat could be achieved in under 24 hours - but I wanted more speed. I curated the relay list based on Nostr event responses I was receiving (both good and bad) and introduced multithreading into my script. It was now hitting over 100 "follow" requests per second and the overall time needed would be reduced.

- **Followers per second**: 100
- **Seconds per minute**: 60
- **Minutes per hour**: 60

Total new followers per hour = 100 * 60 * 60 = 360,000

To hit 1 million followers in 24 hours: 1,000,000 / 360,000 ≈ 2.78 hours

![](https://raw.githubusercontent.com/ronaldstoner/ron/gh-pages/images/nostr-stats.gif)
*It's alive and working*

### Observations

I walked away to eat some dinner and when I came back I saw that some relays started getting overwhelmed and were dropping connections. Others had implemented security controls such as authorization, address whitelisting for publishing, IP address rate limiting, proof-of-work, and other novel systems involving challenges. While this experiment underscores the inherent vulnerabilities in social media networks and the ease with which some of these systems can be exploited, it also highlights positive security controls that are being utilized by some nostr relay operators today.  

Out of the 300 relays I used in my final list, **175 relays (58.33%)** were either using protection mechanisms or were not resolvable publicly. This indicates a strong trend towards enhancing the security and privacy of relay communications.

On the other hand, **125 relays (41.67%)** were found to be active and accessible without any additional protection. While these relays are operational, the absence of protective measures may leave them vulnerable to potential security threats, downtime, or future spam or storage attacks. Nostr relay spam filtering seems to be specific to general event types and posts and not the more esoteric or later introduced event types.

While my script only ran for a few hours, it highlighted a potential vulnerability that a well-motivated and well-resourced attacker could exploit. If someone with malicious intent were to replicate and scale up this approach, they could cause significant event bloat across the Nostr network. This could lead to several serious issues for Nostr relays, including potential downtime, network congestion, and substantial storage challenges.

### Charts and Stats
Thank you to [https://stats.nostr.band](https://stats.nostr.band) for providing the following charts and statistics. 

![](https://raw.githubusercontent.com/ronaldstoner/ron/gh-pages/images/nostr-daily-new-users.png)
*Daily New Users*


![nostr-stats](https://raw.githubusercontent.com/ronaldstoner/ron/gh-pages/images/nostr-total-users.png)
*Total Nostr Users*


![nostr-stats](https://raw.githubusercontent.com/ronaldstoner/ron/gh-pages/images/nostr-total-profile-events.png)
*Total Profile Events Published*


![nostr-stats](https://raw.githubusercontent.com/ronaldstoner/ron/gh-pages/images/nostr-events-published.png)
*Events Published*

### Challenges and Fixes

Despite initial success, several challenges did occur:

- **Authentication (Auth)**: Some relays required authentication thereby limiting access.
- **Whitelisting**: Certain relays only accepted specific accounts.
- **Follows Not Allowed**: Some relays blocked follow events.
- **Rate Limiting**: Relays enforced rate limits to prevent spamming.
- **Proof of Work**: Some relays required proof of work to mitigate spam.
- **Paid Relays**: A few relays operated on a pay-to-use basis.

In addition, the Nostr network should consider implementing:

- **Honey Pot Relays**: Honeypots could help detect and alert on attacks in real time. 
- **Nostr Security Operations**: A dedicated security and monitoring team would help relay operators respond to attacks.
- **Alerting and Monitoring**: As with any large corporation or product, monitoring and alerting is essential.
- **Relay Health Report**: Additional metrics such as free disk space, spam mitigation, and overall health would help identify weak points in the network. 
- **Spam Filters**: Spam filtering technology should be applied for *most* event types rather than just a few. 

It is suggested that relay operators look into the above as mitigation controls for their relays and the overall health of the Nostr network. This may not be applicable in all scenarios and clients though. 

## Conclusion

![](https://raw.githubusercontent.com/ronaldstoner/ron/gh-pages/images/nostr-4million.png)

This experiment revealed just how artificial social media can be. The ease with which follower counts and engagement metrics can be manipulated calls into question the authenticity of online personas and the credibility of social media as a whole.

Nostr's decentralized approach offers robust features, but even it is not immune to exploitation without proper safeguards. Implementing fixes such as authentication, whitelisting, rate limiting, monitoring, alerting, and proof of work can significantly enhance the network's integrity. This is a task for relay operators and Nostr protocol and client developers to tackle after reviewing and evaluating the pros and cons of each potential fix. 

Overall the Nostr network performed wonderfully during my testing. While I was able to cause spammy behavior, I was not able to impact the general availability to the network. I hope to encourage everyone to be more transparent and adopt secure practices (be it relay operators, developers, or end users) in the vast digital social ecosystem. 