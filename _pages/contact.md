---
layout: page
title: Contact
permalink: /contact/
description: Get in touch with Ron Stoner for consulting engagements, security incident response, speaking, or media inquiries.
---

<div id="formkeep-embed" data-formkeep-url="https://formkeep.com/p/48706f4facd173d77baaee87f35bd706?embedded=1"></div>

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