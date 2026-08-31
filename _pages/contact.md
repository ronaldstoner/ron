---
layout: page
title: Contact
permalink: /contact/
description: Get in touch with Ron Stoner for consulting engagements, security incident response, speaking, or media inquiries.
---

<div id="formkeep-embed" data-formkeep-url="https://formkeep.com/p/b2dde3a2f5cd4272140ec9aa2cb1180d?embedded=1"></div>

<script type="text/javascript" src="https://pym.nprapps.org/pym.v1.min.js"></script>
<script type="text/javascript" src="https://cdn.formkeep.com/formkeep-embed.js"></script>

<!-- Get notified when the form is submitted, add your own code below: -->
<script>
const formkeepEmbed = document.querySelector('#formkeep-embed')

formkeepEmbed.addEventListener('formkeep-embed:submitting', _event => {
  console.log('Submitting form...')
})

formkeepEmbed.addEventListener('formkeep-embed:submitted', _event => {
  console.log('Submitted form...')
})
</script>