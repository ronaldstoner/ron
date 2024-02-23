---
layout: page
title: Posts
permalink: /posts/
---

<style>
      {% capture include_to_scssify %}
      {% include post.scss %}
      {% endcapture %}
      {{ include_to_scssify | scssify }}
</style>